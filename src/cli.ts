#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import {
  type JobConfig,
  type JobResult,
  type TasksFile,
  type GoalConfig,
  type SecurityConfig,
  DEFAULT_TOOLS,
  DEFAULT_TIMEOUT,
  DEFAULT_STALL_TIMEOUT,
  DEFAULT_VERIFY_PROMPT,
  DEFAULT_STATE_FILE,
  DEFAULT_GOAL_STATE_FILE,
  DEFAULT_NTFY_TOPIC,
  DEFAULT_MAX_TURNS,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_DENY_PATTERNS,
} from "./types.js";
import { validateSecurityConfig } from "./security.js";
import {
  runJob,
  runJobsWithState,
  loadState,
  resultsToJson,
  taskKey,
} from "./runner.js";
import { sendNtfyNotification } from "./notify.js";
import { generateReport } from "./report.js";
import { runGoal, parseGoalFile } from "./goal-runner.js";
import { runPlanner } from "./planner.js";

const AGENT_HELP = `
# overnight - Autonomous Build Runner for Claude Code

Two modes: goal-driven autonomous loops, or task-list batch jobs.

## Quick Start

\`\`\`bash
# Hammer mode: just give it a goal and go
overnight hammer "Build a multiplayer MMO"

# Or: design session first, then autonomous build
overnight plan "Build a multiplayer game"   # Interactive design → goal.yaml
overnight run goal.yaml --notify            # Autonomous build loop

# Task mode: explicit task list
overnight run tasks.yaml --notify
\`\`\`

## Commands

| Command | Description |
|---------|-------------|
| \`overnight hammer "<goal>"\` | Autonomous build loop from a string |
| \`overnight plan "<goal>"\` | Interactive design session → goal.yaml |
| \`overnight run <file>\` | Run goal.yaml (loop) or tasks.yaml (batch) |
| \`overnight resume <file>\` | Resume interrupted run from checkpoint |
| \`overnight single "<prompt>"\` | Run a single task directly |
| \`overnight init\` | Create example goal.yaml or tasks.yaml |

## Goal Mode (goal.yaml)

Autonomous convergence loop: agent iterates toward a goal, then a separate
gate agent verifies everything before declaring done.

\`\`\`yaml
goal: "Build a clone of Flappy Bird with leaderboard"

acceptance_criteria:
  - "Game renders and is playable in browser"
  - "Leaderboard persists scores to localStorage"

verification_commands:
  - "npm run build"
  - "npm test"

constraints:
  - "Use vanilla JS, no frameworks"

max_iterations: 15
\`\`\`

## Task Mode (tasks.yaml)

Explicit task list with optional dependency DAG.

\`\`\`yaml
defaults:
  timeout_seconds: 300
  verify: true
  allowed_tools: [Read, Edit, Write, Glob, Grep]

tasks:
  - "Fix the bug in auth.py"
  - prompt: "Add input validation"
    timeout_seconds: 600
\`\`\`

## Key Options

| Option | Description |
|--------|-------------|
| \`-o, --output <file>\` | Save results JSON |
| \`-r, --report <file>\` | Generate markdown report |
| \`-s, --state-file <file>\` | Custom checkpoint file |
| \`--max-iterations <n>\` | Max build loop iterations (goal mode) |
| \`--notify\` | Send push notification via ntfy.sh |
| \`-q, --quiet\` | Minimal output |

## Example Workflows

\`\`\`bash
# Simplest: just hammer a goal overnight
nohup overnight hammer "Build a REST API with auth and tests" --notify > overnight.log 2>&1 &

# Design first, then run
overnight plan "Build a REST API with auth"
nohup overnight run goal.yaml --notify > overnight.log 2>&1 &

# Batch tasks overnight
nohup overnight run tasks.yaml --notify -r report.md > overnight.log 2>&1 &

# Resume after crash
overnight resume goal.yaml
\`\`\`

## Exit Codes

- 0: All tasks succeeded / gate passed
- 1: Failures occurred / gate failed

## Files Created

- \`.overnight-goal-state.json\` - Goal mode checkpoint
- \`.overnight-iterations/\` - Per-iteration state + summaries
- \`.overnight-state.json\` - Task mode checkpoint
- \`report.md\` - Summary report (if -r used)

Run \`overnight <command> --help\` for command-specific options.
`;

// --- File type detection ---

function isGoalFile(path: string): boolean {
  try {
    const content = readFileSync(path, "utf-8");
    const data = parseYaml(content) as Record<string, unknown>;
    return typeof data?.goal === "string";
  } catch {
    return false;
  }
}

interface ParsedConfig {
  configs: JobConfig[];
  security?: SecurityConfig;
}

function parseTasksFile(path: string, cliSecurity?: Partial<SecurityConfig>): ParsedConfig {
  const content = readFileSync(path, "utf-8");
  let data: TasksFile | (string | JobConfig)[];
  try {
    data = parseYaml(content) as TasksFile | (string | JobConfig)[];
  } catch (e) {
    const error = e as Error;
    console.error(`\x1b[31mError parsing ${path}:\x1b[0m`);
    console.error(`  ${error.message.split('\n')[0]}`);
    process.exit(1);
  }

  const tasks = Array.isArray(data) ? data : data.tasks ?? [];
  const defaults = Array.isArray(data) ? {} : data.defaults ?? {};

  // Merge CLI security options with file security options (CLI takes precedence)
  const fileSecurity = (!Array.isArray(data) && data.defaults?.security) || {};
  const security: SecurityConfig | undefined = (cliSecurity || Object.keys(fileSecurity).length > 0)
    ? {
        ...fileSecurity,
        ...cliSecurity,
        // Use default deny patterns if none specified
        deny_patterns: cliSecurity?.deny_patterns ?? fileSecurity.deny_patterns ?? DEFAULT_DENY_PATTERNS,
      }
    : undefined;

  const configs = tasks.map((task) => {
    if (typeof task === "string") {
      return {
        prompt: task,
        timeout_seconds: defaults.timeout_seconds ?? DEFAULT_TIMEOUT,
        stall_timeout_seconds:
          defaults.stall_timeout_seconds ?? DEFAULT_STALL_TIMEOUT,
        verify: defaults.verify ?? true,
        verify_prompt: defaults.verify_prompt ?? DEFAULT_VERIFY_PROMPT,
        allowed_tools: defaults.allowed_tools,
        security,
      };
    }
    return {
      id: task.id ?? undefined,
      depends_on: task.depends_on ?? undefined,
      prompt: task.prompt,
      working_dir: task.working_dir ?? undefined,
      timeout_seconds:
        task.timeout_seconds ?? defaults.timeout_seconds ?? DEFAULT_TIMEOUT,
      stall_timeout_seconds:
        task.stall_timeout_seconds ??
        defaults.stall_timeout_seconds ??
        DEFAULT_STALL_TIMEOUT,
      verify: task.verify ?? defaults.verify ?? true,
      verify_prompt:
        task.verify_prompt ?? defaults.verify_prompt ?? DEFAULT_VERIFY_PROMPT,
      allowed_tools: task.allowed_tools ?? defaults.allowed_tools,
      security: task.security ?? security,
    };
  });

  return { configs, security };
}

function printSummary(results: JobResult[]): void {
  const statusColors: Record<string, string> = {
    success: "\x1b[32m",
    failed: "\x1b[31m",
    timeout: "\x1b[33m",
    stalled: "\x1b[35m",
    verification_failed: "\x1b[33m",
  };
  const reset = "\x1b[0m";
  const bold = "\x1b[1m";

  console.log(`\n${bold}Job Results${reset}`);
  console.log("─".repeat(70));

  results.forEach((r, i) => {
    const color = statusColors[r.status] ?? "";
    const task = r.task.length > 40 ? r.task.slice(0, 40) + "..." : r.task;
    const verified = r.verified ? "✓" : "✗";
    console.log(
      `${i + 1}. ${color}${r.status.padEnd(12)}${reset} ${r.duration_seconds.toFixed(1).padStart(6)}s  ${verified}  ${task}`
    );
  });

  const succeeded = results.filter((r) => r.status === "success").length;
  console.log(
    `\n${bold}Summary:${reset} ${succeeded}/${results.length} succeeded`
  );
}

const program = new Command();

program
  .name("overnight")
  .description("Batch job runner for Claude Code")
  .version("0.3.0")
  .action(() => {
    console.log(AGENT_HELP);
  });

program
  .command("run")
  .description("Run goal.yaml (autonomous loop) or tasks.yaml (batch jobs)")
  .argument("<file>", "Path to goal.yaml or tasks.yaml")
  .option("-o, --output <file>", "Output file for results JSON")
  .option("-q, --quiet", "Minimal output")
  .option("-s, --state-file <file>", "Custom state file path")
  .option("--notify", "Send push notification via ntfy.sh")
  .option("--notify-topic <topic>", "ntfy.sh topic", DEFAULT_NTFY_TOPIC)
  .option("-r, --report <file>", "Generate markdown report")
  .option("--sandbox <dir>", "Sandbox directory (restrict file access)")
  .option("--max-turns <n>", "Max agent iterations per task", String(DEFAULT_MAX_TURNS))
  .option("--max-iterations <n>", "Max build loop iterations (goal mode)", String(DEFAULT_MAX_ITERATIONS))
  .option("--audit-log <file>", "Audit log file path")
  .option("--no-security", "Disable default security (deny patterns)")
  .action(async (inputFile, opts) => {
    if (!existsSync(inputFile)) {
      console.error(`Error: File not found: ${inputFile}`);
      process.exit(1);
    }

    // Detect file type and dispatch
    if (isGoalFile(inputFile)) {
      // --- Goal mode ---
      const goal = parseGoalFile(inputFile);

      // Apply CLI overrides
      if (opts.maxIterations) {
        goal.max_iterations = parseInt(opts.maxIterations, 10);
      }
      if (opts.sandbox) {
        goal.defaults = goal.defaults ?? {};
        goal.defaults.security = goal.defaults.security ?? {};
        goal.defaults.security.sandbox_dir = opts.sandbox;
      }
      if (opts.maxTurns) {
        goal.defaults = goal.defaults ?? {};
        goal.defaults.security = goal.defaults.security ?? {};
        goal.defaults.security.max_turns = parseInt(opts.maxTurns, 10);
      }

      const log = opts.quiet ? undefined : (msg: string) => console.log(msg);
      const startTime = Date.now();

      const runState = await runGoal(goal, {
        stateFile: opts.stateFile ?? DEFAULT_GOAL_STATE_FILE,
        log,
      });

      const totalDuration = (Date.now() - startTime) / 1000;

      if (opts.notify) {
        const passed = runState.status === "gate_passed";
        const title = passed
          ? `overnight: Goal completed (${runState.iterations.length} iterations)`
          : `overnight: ${runState.status} after ${runState.iterations.length} iterations`;
        const message = passed
          ? `Gate passed. ${runState.iterations.length} iterations.`
          : `Status: ${runState.status}. Check report for details.`;

        try {
          await fetch(`https://ntfy.sh/${opts.notifyTopic ?? DEFAULT_NTFY_TOPIC}`, {
            method: "POST",
            headers: {
              Title: title,
              Priority: passed ? "default" : "high",
              Tags: passed ? "white_check_mark" : "warning",
            },
            body: message,
          });
          if (!opts.quiet) console.log(`\x1b[2mNotification sent\x1b[0m`);
        } catch {
          if (!opts.quiet) console.log("\x1b[33mWarning: Failed to send notification\x1b[0m");
        }
      }

      // Print summary
      if (!opts.quiet) {
        console.log(`\n\x1b[1m━━━ Goal Run Summary ━━━\x1b[0m`);
        console.log(`Status: ${runState.status === "gate_passed" ? "\x1b[32m" : "\x1b[31m"}${runState.status}\x1b[0m`);
        console.log(`Iterations: ${runState.iterations.length}`);
        console.log(`Gate attempts: ${runState.gate_results.length}`);

        // Duration formatting
        let durationStr: string;
        if (totalDuration >= 3600) {
          const hours = Math.floor(totalDuration / 3600);
          const mins = Math.floor((totalDuration % 3600) / 60);
          durationStr = `${hours}h ${mins}m`;
        } else if (totalDuration >= 60) {
          const mins = Math.floor(totalDuration / 60);
          const secs = Math.floor(totalDuration % 60);
          durationStr = `${mins}m ${secs}s`;
        } else {
          durationStr = `${totalDuration.toFixed(1)}s`;
        }
        console.log(`Duration: ${durationStr}`);

        if (runState.gate_results.length > 0) {
          const lastGate = runState.gate_results[runState.gate_results.length - 1];
          console.log(`\nGate: ${lastGate.summary}`);
          for (const check of lastGate.checks) {
            const icon = check.passed ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
            console.log(`  ${icon} ${check.name}`);
          }
        }
      }

      if (runState.status !== "gate_passed") {
        process.exit(1);
      }
    } else {
      // --- Task mode (legacy) ---
      const cliSecurity: Partial<SecurityConfig> | undefined = opts.security === false
        ? undefined
        : {
            ...(opts.sandbox && { sandbox_dir: opts.sandbox }),
            ...(opts.maxTurns && { max_turns: parseInt(opts.maxTurns, 10) }),
            ...(opts.auditLog && { audit_log: opts.auditLog }),
          };

      const { configs, security } = parseTasksFile(inputFile, cliSecurity);
      if (configs.length === 0) {
        console.error("No tasks found in file");
        process.exit(1);
      }

      const existingState = loadState(opts.stateFile ?? DEFAULT_STATE_FILE);
      if (existingState) {
        const done = Object.keys(existingState.completed).length;
        const pending = configs.filter(c => !(taskKey(c) in existingState.completed)).length;
        console.log(`\x1b[1movernight: Resuming — ${done} done, ${pending} remaining\x1b[0m`);
        console.log(`\x1b[2mLast checkpoint: ${existingState.timestamp}\x1b[0m`);
      } else {
        console.log(`\x1b[1movernight: Running ${configs.length} jobs...\x1b[0m`);
      }

      if (security && !opts.quiet) {
        console.log("\x1b[2mSecurity:\x1b[0m");
        validateSecurityConfig(security);
      }
      console.log("");

      const log = opts.quiet ? undefined : (msg: string) => console.log(msg);
      const startTime = Date.now();
      const reloadConfigs = () => parseTasksFile(inputFile, cliSecurity).configs;

      const results = await runJobsWithState(configs, {
        stateFile: opts.stateFile,
        log,
        reloadConfigs,
      });

      const totalDuration = (Date.now() - startTime) / 1000;

      if (opts.notify) {
        const success = await sendNtfyNotification(results, totalDuration, opts.notifyTopic);
        if (success) {
          console.log(`\x1b[2mNotification sent to ntfy.sh/${opts.notifyTopic}\x1b[0m`);
        } else {
          console.log("\x1b[33mWarning: Failed to send notification\x1b[0m");
        }
      }

      if (opts.report) {
        generateReport(results, totalDuration, opts.report);
        console.log(`\x1b[2mReport saved to ${opts.report}\x1b[0m`);
      }

      if (!opts.quiet) {
        printSummary(results);
      }

      if (opts.output) {
        writeFileSync(opts.output, resultsToJson(results));
        console.log(`\n\x1b[2mResults saved to ${opts.output}\x1b[0m`);
      }

      if (results.some((r) => r.status !== "success")) {
        process.exit(1);
      }
    }
  });

program
  .command("resume")
  .description("Resume a previous run from saved state")
  .argument("<tasks-file>", "Path to tasks.yaml file")
  .option("-o, --output <file>", "Output file for results JSON")
  .option("-q, --quiet", "Minimal output")
  .option("-s, --state-file <file>", "Custom state file path")
  .option("--notify", "Send push notification via ntfy.sh")
  .option("--notify-topic <topic>", "ntfy.sh topic", DEFAULT_NTFY_TOPIC)
  .option("-r, --report <file>", "Generate markdown report")
  .option("--sandbox <dir>", "Sandbox directory (restrict file access)")
  .option("--max-turns <n>", "Max agent iterations per task", String(DEFAULT_MAX_TURNS))
  .option("--audit-log <file>", "Audit log file path")
  .option("--no-security", "Disable default security (deny patterns)")
  .action(async (tasksFile, opts) => {
    const stateFile = opts.stateFile ?? DEFAULT_STATE_FILE;
    const state = loadState(stateFile);

    if (!state) {
      console.error(`No state file found at ${stateFile}`);
      console.error("Run 'overnight run' first to start jobs.");
      process.exit(1);
    }

    if (!existsSync(tasksFile)) {
      console.error(`Error: File not found: ${tasksFile}`);
      process.exit(1);
    }

    // Build CLI security config
    const cliSecurity: Partial<SecurityConfig> | undefined = opts.security === false
      ? undefined
      : {
          ...(opts.sandbox && { sandbox_dir: opts.sandbox }),
          ...(opts.maxTurns && { max_turns: parseInt(opts.maxTurns, 10) }),
          ...(opts.auditLog && { audit_log: opts.auditLog }),
        };

    const { configs, security } = parseTasksFile(tasksFile, cliSecurity);
    if (configs.length === 0) {
      console.error("No tasks found in file");
      process.exit(1);
    }

    const completedCount = Object.keys(state.completed).length;
    const pendingCount = configs.filter(c => !(taskKey(c) in state.completed)).length;
    console.log(
      `\x1b[1movernight: Resuming — ${completedCount} done, ${pendingCount} remaining\x1b[0m`
    );
    console.log(`\x1b[2mLast checkpoint: ${state.timestamp}\x1b[0m`);

    // Show security config if enabled
    if (security && !opts.quiet) {
      console.log("\x1b[2mSecurity:\x1b[0m");
      validateSecurityConfig(security);
    }
    console.log("");

    const log = opts.quiet ? undefined : (msg: string) => console.log(msg);
    const startTime = Date.now();
    const reloadConfigs = () => parseTasksFile(tasksFile, cliSecurity).configs;

    const results = await runJobsWithState(configs, {
      stateFile,
      log,
      reloadConfigs,
    });

    const totalDuration = (Date.now() - startTime) / 1000;

    if (opts.notify) {
      const success = await sendNtfyNotification(
        results,
        totalDuration,
        opts.notifyTopic
      );
      if (success) {
        console.log(`\x1b[2mNotification sent to ntfy.sh/${opts.notifyTopic}\x1b[0m`);
      } else {
        console.log("\x1b[33mWarning: Failed to send notification\x1b[0m");
      }
    }

    if (opts.report) {
      generateReport(results, totalDuration, opts.report);
      console.log(`\x1b[2mReport saved to ${opts.report}\x1b[0m`);
    }

    if (!opts.quiet) {
      printSummary(results);
    }

    if (opts.output) {
      writeFileSync(opts.output, resultsToJson(results));
      console.log(`\n\x1b[2mResults saved to ${opts.output}\x1b[0m`);
    }

    if (results.some((r) => r.status !== "success")) {
      process.exit(1);
    }
  });

program
  .command("single")
  .description("Run a single job directly")
  .argument("<prompt>", "The task prompt")
  .option("-t, --timeout <seconds>", "Timeout in seconds", "300")
  .option("--verify", "Run verification pass", true)
  .option("--no-verify", "Skip verification pass")
  .option("-T, --tools <tool...>", "Allowed tools")
  .option("--sandbox <dir>", "Sandbox directory (restrict file access)")
  .option("--max-turns <n>", "Max agent iterations", String(DEFAULT_MAX_TURNS))
  .option("--no-security", "Disable default security (deny patterns)")
  .action(async (prompt, opts) => {
    // Build security config
    const security: SecurityConfig | undefined = opts.security === false
      ? undefined
      : {
          ...(opts.sandbox && { sandbox_dir: opts.sandbox }),
          ...(opts.maxTurns && { max_turns: parseInt(opts.maxTurns, 10) }),
          deny_patterns: DEFAULT_DENY_PATTERNS,
        };

    const config: JobConfig = {
      prompt,
      timeout_seconds: parseInt(opts.timeout, 10),
      verify: opts.verify,
      allowed_tools: opts.tools,
      security,
    };

    const log = (msg: string) => console.log(msg);
    const result = await runJob(config, log);

    if (result.status === "success") {
      console.log("\n\x1b[32mSuccess\x1b[0m");
      if (result.result) {
        console.log(result.result);
      }
    } else {
      console.log(`\n\x1b[31m${result.status}\x1b[0m`);
      if (result.error) {
        console.log(`\x1b[31m${result.error}\x1b[0m`);
      }
      process.exit(1);
    }
  });

program
  .command("hammer")
  .description("Autonomous build loop from an inline goal string")
  .argument("<goal>", "The goal to work toward")
  .option("--max-iterations <n>", "Max build loop iterations", String(DEFAULT_MAX_ITERATIONS))
  .option("--max-turns <n>", "Max agent turns per iteration", String(DEFAULT_MAX_TURNS))
  .option("-t, --timeout <seconds>", "Timeout per iteration in seconds", "600")
  .option("-T, --tools <tool...>", "Allowed tools")
  .option("--sandbox <dir>", "Sandbox directory")
  .option("-s, --state-file <file>", "Custom state file path")
  .option("--notify", "Send push notification via ntfy.sh")
  .option("--notify-topic <topic>", "ntfy.sh topic", DEFAULT_NTFY_TOPIC)
  .option("-q, --quiet", "Minimal output")
  .option("--no-security", "Disable default security")
  .action(async (goalStr, opts) => {
    const goal: GoalConfig = {
      goal: goalStr,
      max_iterations: parseInt(opts.maxIterations, 10),
      defaults: {
        timeout_seconds: parseInt(opts.timeout, 10),
        allowed_tools: opts.tools ?? [...DEFAULT_TOOLS, "Bash"],
        security: opts.security === false
          ? undefined
          : {
              ...(opts.sandbox && { sandbox_dir: opts.sandbox }),
              max_turns: parseInt(opts.maxTurns, 10),
              deny_patterns: DEFAULT_DENY_PATTERNS,
            },
      },
    };

    const log = opts.quiet ? undefined : (msg: string) => console.log(msg);
    const startTime = Date.now();

    const runState = await runGoal(goal, {
      stateFile: opts.stateFile ?? DEFAULT_GOAL_STATE_FILE,
      log,
    });

    const totalDuration = (Date.now() - startTime) / 1000;

    if (opts.notify) {
      const passed = runState.status === "gate_passed";
      try {
        await fetch(`https://ntfy.sh/${opts.notifyTopic ?? DEFAULT_NTFY_TOPIC}`, {
          method: "POST",
          headers: {
            Title: passed
              ? `overnight: Goal completed (${runState.iterations.length} iterations)`
              : `overnight: ${runState.status} after ${runState.iterations.length} iterations`,
            Priority: passed ? "default" : "high",
            Tags: passed ? "white_check_mark" : "warning",
          },
          body: passed
            ? `Gate passed. ${runState.iterations.length} iterations.`
            : `Status: ${runState.status}. Check report for details.`,
        });
        if (!opts.quiet) console.log(`\x1b[2mNotification sent\x1b[0m`);
      } catch {
        if (!opts.quiet) console.log("\x1b[33mWarning: Failed to send notification\x1b[0m");
      }
    }

    if (!opts.quiet) {
      console.log(`\n\x1b[1m━━━ Hammer Summary ━━━\x1b[0m`);
      console.log(`Status: ${runState.status === "gate_passed" ? "\x1b[32m" : "\x1b[31m"}${runState.status}\x1b[0m`);
      console.log(`Iterations: ${runState.iterations.length}`);
      console.log(`Gate attempts: ${runState.gate_results.length}`);

      let durationStr: string;
      if (totalDuration >= 3600) {
        const hours = Math.floor(totalDuration / 3600);
        const mins = Math.floor((totalDuration % 3600) / 60);
        durationStr = `${hours}h ${mins}m`;
      } else if (totalDuration >= 60) {
        const mins = Math.floor(totalDuration / 60);
        const secs = Math.floor(totalDuration % 60);
        durationStr = `${mins}m ${secs}s`;
      } else {
        durationStr = `${totalDuration.toFixed(1)}s`;
      }
      console.log(`Duration: ${durationStr}`);

      if (runState.gate_results.length > 0) {
        const lastGate = runState.gate_results[runState.gate_results.length - 1];
        console.log(`\nGate: ${lastGate.summary}`);
        for (const check of lastGate.checks) {
          const icon = check.passed ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
          console.log(`  ${icon} ${check.name}`);
        }
      }
    }

    if (runState.status !== "gate_passed") {
      process.exit(1);
    }
  });

program
  .command("plan")
  .description("Interactive design session to create a goal.yaml")
  .argument("<goal>", "High-level goal description")
  .option("-o, --output <file>", "Output file path", "goal.yaml")
  .action(async (goal, opts) => {
    const result = await runPlanner(goal, {
      outputFile: opts.output,
      log: (msg: string) => console.log(msg),
    });

    if (!result) {
      process.exit(1);
    }
  });

program
  .command("init")
  .description("Create an example goal.yaml or tasks.yaml")
  .option("--tasks", "Create tasks.yaml instead of goal.yaml")
  .action((opts) => {
    if (opts.tasks) {
      // Legacy tasks.yaml template
      const example = `# overnight task file
# Run with: overnight run tasks.yaml

defaults:
  timeout_seconds: 300  # 5 minutes per task
  verify: true          # Run verification after each task

  # Secure defaults - no Bash, just file operations
  allowed_tools:
    - Read
    - Edit
    - Write
    - Glob
    - Grep

  # Security settings (optional - deny_patterns enabled by default)
  security:
    sandbox_dir: "."      # Restrict to current directory
    max_turns: 100        # Prevent runaway agents
    # audit_log: "overnight-audit.log"  # Uncomment to enable

tasks:
  # Simple string format
  - "Find and fix any TODO comments in the codebase"

  # Dict format with overrides
  - prompt: "Add input validation to all form handlers"
    timeout_seconds: 600  # Allow more time

  - prompt: "Review code for security issues"
    verify: false  # Don't need to verify a review

  # Can add Bash for specific tasks that need it
  - prompt: "Run the test suite and fix any failures"
    allowed_tools:
      - Read
      - Edit
      - Bash
      - Glob
      - Grep
`;

      if (existsSync("tasks.yaml")) {
        console.log("\x1b[33mtasks.yaml already exists\x1b[0m");
        process.exit(1);
      }

      writeFileSync("tasks.yaml", example);
      console.log("\x1b[32mCreated tasks.yaml\x1b[0m");
      console.log("Edit the file, then run: \x1b[1movernight run tasks.yaml\x1b[0m");
    } else {
      // Goal mode template (new default)
      const example = `# overnight goal file
# Run with: overnight run goal.yaml
#
# Or use "overnight plan" for an interactive design session:
#   overnight plan "Build a multiplayer game"

goal: "Describe your project goal here"

acceptance_criteria:
  - "The project builds without errors"
  - "All tests pass"
  - "Core features are functional"

verification_commands:
  - "npm run build"
  - "npm test"

constraints:
  - "Don't modify existing API contracts"
  - "Keep dependencies minimal"

# How many build iterations before stopping
max_iterations: 15

# Stop if remaining items don't shrink for this many iterations
convergence_threshold: 3

defaults:
  timeout_seconds: 600    # 10 minutes per iteration
  allowed_tools:
    - Read
    - Edit
    - Write
    - Glob
    - Grep
    - Bash
  security:
    sandbox_dir: "."
    max_turns: 150
`;

      if (existsSync("goal.yaml")) {
        console.log("\x1b[33mgoal.yaml already exists\x1b[0m");
        process.exit(1);
      }

      writeFileSync("goal.yaml", example);
      console.log("\x1b[32mCreated goal.yaml\x1b[0m");
      console.log("Edit the file, then run: \x1b[1movernight run goal.yaml\x1b[0m");
      console.log("\x1b[2mTip: Use 'overnight plan \"your goal\"' for an interactive design session\x1b[0m");
    }
  });

program.parse();
