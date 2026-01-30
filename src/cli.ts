#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import {
  type JobConfig,
  type JobResult,
  type TasksFile,
  type SecurityConfig,
  DEFAULT_TIMEOUT,
  DEFAULT_STALL_TIMEOUT,
  DEFAULT_VERIFY_PROMPT,
  DEFAULT_STATE_FILE,
  DEFAULT_NTFY_TOPIC,
  DEFAULT_MAX_TURNS,
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

const AGENT_HELP = `
# overnight - Batch Job Runner for Claude Code

Queue tasks, run them unattended, get results. Designed for overnight/AFK use.

## Quick Start

\`\`\`bash
# Create a tasks.yaml file
overnight init

# Run all tasks
overnight run tasks.yaml

# Run with notifications and report
overnight run tasks.yaml --notify -r report.md
\`\`\`

## Commands

| Command | Description |
|---------|-------------|
| \`overnight run <file>\` | Run jobs from YAML file |
| \`overnight resume <file>\` | Resume interrupted run from checkpoint |
| \`overnight single "<prompt>"\` | Run a single task directly |
| \`overnight init\` | Create example tasks.yaml |

## tasks.yaml Format

\`\`\`yaml
defaults:
  timeout_seconds: 300      # Per-task timeout (default: 300)
  verify: true              # Run verification pass (default: true)
  allowed_tools:            # Whitelist tools (default: Read,Edit,Write,Glob,Grep)
    - Read
    - Edit
    - Glob
    - Grep

tasks:
  # Simple format
  - "Fix the bug in auth.py"

  # Detailed format
  - prompt: "Add input validation"
    timeout_seconds: 600
    verify: false
    allowed_tools: [Read, Edit, Bash, Glob, Grep]
\`\`\`

## Key Options

| Option | Description |
|--------|-------------|
| \`-o, --output <file>\` | Save results JSON |
| \`-r, --report <file>\` | Generate markdown report |
| \`-s, --state-file <file>\` | Custom checkpoint file |
| \`--notify\` | Send push notification via ntfy.sh |
| \`--notify-topic <topic>\` | ntfy.sh topic (default: overnight) |
| \`-q, --quiet\` | Minimal output |

## Features

1. **Crash Recovery**: Auto-checkpoints after each job. Use \`overnight resume\` to continue.
2. **Retry Logic**: Auto-retries 3x on API/network errors with exponential backoff.
3. **Notifications**: \`--notify\` sends summary to ntfy.sh (free, no signup).
4. **Reports**: \`-r report.md\` generates markdown summary with next steps.
5. **Security**: No Bash by default. Whitelist tools per-task.

## Example Workflows

\`\`\`bash
# Development: run overnight, check in morning
nohup overnight run tasks.yaml --notify -r report.md -o results.json > overnight.log 2>&1 &

# CI/CD: run and fail if any task fails
overnight run tasks.yaml -q

# Single task with Bash access
overnight single "Run tests and fix failures" -T Read -T Edit -T Bash -T Glob

# Resume after crash/interrupt
overnight resume tasks.yaml
\`\`\`

## Exit Codes

- 0: All tasks succeeded
- 1: One or more tasks failed

## Files Created

- \`.overnight-state.json\` - Checkpoint file (deleted on success)
- \`report.md\` - Summary report (if -r used)
- \`results.json\` - Full results (if -o used)

Run \`overnight <command> --help\` for command-specific options.
`;

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
  .version("0.2.0")
  .action(() => {
    console.log(AGENT_HELP);
  });

program
  .command("run")
  .description("Run jobs from a YAML tasks file")
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

    // Check if resuming from existing state
    const existingState = loadState(opts.stateFile ?? DEFAULT_STATE_FILE);
    if (existingState) {
      const done = Object.keys(existingState.completed).length;
      const pending = configs.filter(c => !(taskKey(c) in existingState.completed)).length;
      console.log(`\x1b[1movernight: Resuming — ${done} done, ${pending} remaining\x1b[0m`);
      console.log(`\x1b[2mLast checkpoint: ${existingState.timestamp}\x1b[0m`);
    } else {
      console.log(`\x1b[1movernight: Running ${configs.length} jobs...\x1b[0m`);
    }

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
      stateFile: opts.stateFile,
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
  .command("init")
  .description("Create an example tasks.yaml file")
  .action(() => {
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
    # deny_patterns:       # Default patterns block .env, .key, .pem, etc.
    #   - "**/.env*"
    #   - "**/*.key"

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
  });

program.parse();
