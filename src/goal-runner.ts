import { query, type Options as ClaudeCodeOptions } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  type GoalConfig,
  type GoalRunState,
  type IterationState,
  type GateResult,
  type GateCheck,
  type SecurityConfig,
  DEFAULT_TOOLS,
  DEFAULT_TIMEOUT,
  DEFAULT_GOAL_STATE_FILE,
  DEFAULT_MAX_TURNS,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_CONVERGENCE_THRESHOLD,
  DEFAULT_DENY_PATTERNS,
} from "./types.js";
import { createSecurityHooks } from "./security.js";

type LogCallback = (msg: string) => void;

// --- State persistence ---

const ITERATION_DIR = ".overnight-iterations";

function ensureIterationDir(): void {
  if (!existsSync(ITERATION_DIR)) {
    mkdirSync(ITERATION_DIR, { recursive: true });
  }
}

export function saveGoalState(state: GoalRunState, stateFile: string): void {
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

export function loadGoalState(stateFile: string): GoalRunState | null {
  if (!existsSync(stateFile)) return null;
  return JSON.parse(readFileSync(stateFile, "utf-8"));
}

function saveIterationState(iteration: number, state: IterationState): void {
  ensureIterationDir();
  writeFileSync(
    `${ITERATION_DIR}/iteration-${iteration}-state.yaml`,
    stringifyYaml(state)
  );
}

function saveIterationNarrative(iteration: number, narrative: string): void {
  ensureIterationDir();
  writeFileSync(
    `${ITERATION_DIR}/iteration-${iteration}-summary.md`,
    narrative
  );
}

function loadPreviousIterationState(iteration: number): IterationState | null {
  const path = `${ITERATION_DIR}/iteration-${iteration}-state.yaml`;
  if (!existsSync(path)) return null;
  return parseYaml(readFileSync(path, "utf-8")) as IterationState;
}

function loadPreviousNarrative(iteration: number): string | null {
  const path = `${ITERATION_DIR}/iteration-${iteration}-summary.md`;
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8");
}

// --- Convergence detection ---

function isConverging(states: IterationState[], threshold: number): boolean {
  if (states.length < threshold) return true; // Not enough data yet

  const recent = states.slice(-threshold);
  const remainingCounts = recent.map((s) => s.remaining_items.length);

  // Check if remaining items stopped shrinking
  for (let i = 1; i < remainingCounts.length; i++) {
    if (remainingCounts[i] < remainingCounts[i - 1]) {
      return true; // Still making progress
    }
  }

  return false; // Stalled
}

// --- Progress display ---

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

class ProgressDisplay {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private startTime = Date.now();
  private currentActivity = "Working";

  start(activity: string): void {
    this.currentActivity = activity;
    this.startTime = Date.now();
    this.frame = 0;
    if (this.interval) return;
    this.interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
      process.stdout.write(
        `\r\x1b[K${SPINNER_FRAMES[this.frame]} ${this.currentActivity} (${elapsed}s)`
      );
      this.frame = (this.frame + 1) % SPINNER_FRAMES.length;
    }, 100);
  }

  stop(finalMessage?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write("\r\x1b[K");
    if (finalMessage) console.log(finalMessage);
  }
}

// --- Claude execution helpers ---

let claudeExecutablePath: string | undefined;

function findClaudeExecutable(): string | undefined {
  if (claudeExecutablePath !== undefined) return claudeExecutablePath;
  if (process.env.CLAUDE_CODE_PATH) {
    claudeExecutablePath = process.env.CLAUDE_CODE_PATH;
    return claudeExecutablePath;
  }
  try {
    const cmd = process.platform === "win32" ? "where claude" : "which claude";
    claudeExecutablePath = execSync(cmd, { encoding: "utf-8" }).trim().split("\n")[0];
    return claudeExecutablePath;
  } catch {
    const commonPaths = [
      "/usr/local/bin/claude",
      "/opt/homebrew/bin/claude",
      `${process.env.HOME}/.local/bin/claude`,
    ];
    for (const p of commonPaths) {
      if (existsSync(p)) {
        claudeExecutablePath = p;
        return claudeExecutablePath;
      }
    }
  }
  return undefined;
}

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs);
  });
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (e) {
    clearTimeout(timeoutId!);
    throw e;
  }
}

async function runClaudePrompt(
  prompt: string,
  config: GoalConfig,
  log: LogCallback,
  progress: ProgressDisplay,
  resumeSessionId?: string,
): Promise<{ result?: string; sessionId?: string }> {
  const claudePath = findClaudeExecutable();
  if (!claudePath) {
    throw new Error("Claude CLI not found. Install with: curl -fsSL https://claude.ai/install.sh | bash");
  }

  const tools = config.defaults?.allowed_tools ?? DEFAULT_TOOLS;
  const timeout = (config.defaults?.timeout_seconds ?? DEFAULT_TIMEOUT) * 1000;
  const security = config.defaults?.security;
  const securityHooks = security ? createSecurityHooks(security) : undefined;

  const sdkOptions: ClaudeCodeOptions = {
    allowedTools: tools,
    permissionMode: "acceptEdits",
    pathToClaudeCodeExecutable: claudePath,
    ...(security?.max_turns && { maxTurns: security.max_turns }),
    ...(securityHooks && { hooks: securityHooks }),
    ...(resumeSessionId && { resume: resumeSessionId }),
  };

  let sessionId: string | undefined;
  let result: string | undefined;

  const conversation = query({ prompt, options: sdkOptions });

  for await (const message of conversation) {
    if (message.type === "result") {
      sessionId = message.session_id;
      if (message.subtype === "success") {
        result = message.result;
      }
    } else if (message.type === "system" && "subtype" in message) {
      if (message.subtype === "init") {
        sessionId = message.session_id;
      }
    }
  }

  return { result, sessionId };
}

// --- Build iteration ---

function buildIterationPrompt(
  goal: GoalConfig,
  iteration: number,
  previousState: IterationState | null,
  previousNarrative: string | null,
): string {
  const parts: string[] = [];

  parts.push(`# Goal\n\n${goal.goal}`);

  if (goal.acceptance_criteria && goal.acceptance_criteria.length > 0) {
    parts.push(`\n# Acceptance Criteria\n\n${goal.acceptance_criteria.map((c) => `- ${c}`).join("\n")}`);
  }

  if (goal.constraints && goal.constraints.length > 0) {
    parts.push(`\n# Constraints\n\n${goal.constraints.map((c) => `- ${c}`).join("\n")}`);
  }

  if (goal.verification_commands && goal.verification_commands.length > 0) {
    parts.push(`\n# Verification Commands (must pass)\n\n${goal.verification_commands.map((c) => `- \`${c}\``).join("\n")}`);
  }

  parts.push(`\n# Iteration ${iteration}`);

  if (previousState && previousNarrative) {
    parts.push(`\n## Previous Iteration State\n\n### Completed Items\n${previousState.completed_items.map((i) => `- ${i}`).join("\n") || "- (none yet)"}`);
    parts.push(`\n### Remaining Items\n${previousState.remaining_items.map((i) => `- ${i}`).join("\n") || "- (none)"}`);
    parts.push(`\n### Known Issues\n${previousState.known_issues.map((i) => `- ${i}`).join("\n") || "- (none)"}`);
    parts.push(`\n### Files Modified\n${previousState.files_modified.map((f) => `- ${f}`).join("\n") || "- (none)"}`);
    parts.push(`\n### Previous Summary\n\n${previousNarrative}`);
  }

  parts.push(`\n# Instructions

You are iteration ${iteration} of an autonomous build loop working toward the goal above.

1. Assess the current state of the project
2. Identify the highest-priority remaining work
3. Implement as much as you can in this iteration
4. When done, output your structured state update in the following EXACT format:

\`\`\`yaml
completed_items:
  - "item 1 you completed"
  - "item 2 you completed"
remaining_items:
  - "item still to do"
  - "another item still to do"
known_issues:
  - "any issues found"
files_modified:
  - "path/to/file1.ts"
  - "path/to/file2.ts"
agent_done: false  # Set to true ONLY if you believe the goal is fully met
\`\`\`

5. After the YAML block, write a brief narrative summary (2-3 paragraphs) of what you did, what challenges you encountered, and what the next iteration should focus on.

IMPORTANT: Always output the YAML block wrapped in \`\`\`yaml ... \`\`\` fences. This is how state is tracked between iterations.`);

  return parts.join("\n");
}

function parseIterationOutput(output: string, iteration: number): { state: IterationState; narrative: string } {
  // Extract YAML block
  const yamlMatch = output.match(/```yaml\n([\s\S]*?)\n```/);

  let state: IterationState;

  if (yamlMatch) {
    try {
      const parsed = parseYaml(yamlMatch[1]) as Partial<IterationState>;
      state = {
        iteration,
        completed_items: parsed.completed_items ?? [],
        remaining_items: parsed.remaining_items ?? [],
        known_issues: parsed.known_issues ?? [],
        files_modified: parsed.files_modified ?? [],
        agent_done: parsed.agent_done ?? false,
        timestamp: new Date().toISOString(),
      };
    } catch {
      // Failed to parse YAML, create minimal state
      state = {
        iteration,
        completed_items: [],
        remaining_items: ["(failed to parse agent output)"],
        known_issues: ["Agent output did not contain valid YAML state block"],
        files_modified: [],
        agent_done: false,
        timestamp: new Date().toISOString(),
      };
    }
  } else {
    state = {
      iteration,
      completed_items: [],
      remaining_items: ["(no structured output from agent)"],
      known_issues: ["Agent did not output a YAML state block"],
      files_modified: [],
      agent_done: false,
      timestamp: new Date().toISOString(),
    };
  }

  // Extract narrative (everything after the YAML block, or the whole output if no YAML)
  let narrative: string;
  if (yamlMatch) {
    const afterYaml = output.slice(output.indexOf("```", output.indexOf("```yaml") + 7) + 3).trim();
    narrative = afterYaml || "(no narrative provided)";
  } else {
    narrative = output;
  }

  return { state, narrative };
}

// --- Final gate agent ---

function buildGatePrompt(goal: GoalConfig, iterationStates: IterationState[]): string {
  const lastState = iterationStates[iterationStates.length - 1];

  const parts: string[] = [];

  parts.push(`# Final Verification Gate

You are a dedicated verification agent. You did NOT write this code. Your only job is to determine if the goal has been met to production quality. Be rigorous and honest.

## Goal

${goal.goal}`);

  if (goal.acceptance_criteria && goal.acceptance_criteria.length > 0) {
    parts.push(`\n## Acceptance Criteria (ALL must be met)\n\n${goal.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}`);
  }

  if (goal.verification_commands && goal.verification_commands.length > 0) {
    parts.push(`\n## Required Verification Commands\n\nRun ALL of these. Each must pass:\n${goal.verification_commands.map((c) => `- \`${c}\``).join("\n")}`);
  }

  parts.push(`\n## Build Agent's Final State

### Completed Items
${lastState?.completed_items.map((i) => `- ${i}`).join("\n") || "- (none)"}

### Claimed Remaining Items
${lastState?.remaining_items.map((i) => `- ${i}`).join("\n") || "- (none)"}

### Known Issues
${lastState?.known_issues.map((i) => `- ${i}`).join("\n") || "- (none)"}

## Instructions

Perform EVERY form of verification you can:

1. **Build check**: Does the project compile/build without errors?
2. **Lint/type check**: Are there type errors or lint warnings?
3. **Unit tests**: Do all unit tests pass?
4. **E2E tests**: Do end-to-end tests pass?
5. **Visual review**: Check rendered output if applicable
6. **Manual walkthrough**: Trace key user flows through the code
7. **Acceptance criteria**: Verify each criterion explicitly
8. **Verification commands**: Run each command listed above
9. **Code quality**: Look for obvious bugs, missing error handling, broken imports
10. **Integration**: Is everything wired up? No dead code, no missing connections?

After your review, output your verdict in this EXACT format:

\`\`\`yaml
passed: false  # or true
checks:
  - name: "Build"
    passed: true
    output: "npm run build succeeded"
  - name: "Unit tests"
    passed: false
    output: "3 tests failed: ..."
summary: "Brief overall assessment"
failures:
  - "Description of failure 1"
  - "Description of failure 2"
\`\`\`

Be thorough. Do not let bad quality pass. If ANYTHING is broken, set passed: false.`);

  return parts.join("\n");
}

function parseGateOutput(output: string): GateResult {
  const yamlMatch = output.match(/```yaml\n([\s\S]*?)\n```/);

  if (yamlMatch) {
    try {
      const parsed = parseYaml(yamlMatch[1]) as Partial<GateResult>;
      return {
        passed: parsed.passed ?? false,
        checks: (parsed.checks ?? []).map((c: Partial<GateCheck>) => ({
          name: c.name ?? "unknown",
          passed: c.passed ?? false,
          output: c.output ?? "",
        })),
        summary: parsed.summary ?? "",
        failures: parsed.failures ?? [],
      };
    } catch {
      return {
        passed: false,
        checks: [],
        summary: "Failed to parse gate agent output",
        failures: ["Gate agent output was not valid YAML"],
      };
    }
  }

  return {
    passed: false,
    checks: [],
    summary: "Gate agent did not output a structured verdict",
    failures: ["No YAML verdict block found in gate agent output"],
  };
}

// --- Main goal runner ---

export async function runGoal(
  goal: GoalConfig,
  options: {
    stateFile?: string;
    log?: LogCallback;
    notify?: boolean;
    notifyTopic?: string;
  } = {}
): Promise<GoalRunState> {
  const stateFile = options.stateFile ?? DEFAULT_GOAL_STATE_FILE;
  const log = options.log ?? (() => {});
  const maxIterations = goal.max_iterations ?? DEFAULT_MAX_ITERATIONS;
  const convergenceThreshold = goal.convergence_threshold ?? DEFAULT_CONVERGENCE_THRESHOLD;
  const progress = new ProgressDisplay();

  // Load or create state
  let runState: GoalRunState = loadGoalState(stateFile) ?? {
    goal: goal.goal,
    iterations: [],
    gate_results: [],
    status: "running",
    timestamp: new Date().toISOString(),
  };

  const startIteration = runState.iterations.length + 1;

  if (startIteration > 1) {
    log(`\x1b[1movernight: Resuming from iteration ${startIteration}\x1b[0m`);
  } else {
    log(`\x1b[1movernight: Starting goal loop\x1b[0m`);
    log(`\x1b[2mGoal: ${goal.goal.slice(0, 80)}${goal.goal.length > 80 ? "..." : ""}\x1b[0m`);
    log(`\x1b[2mMax iterations: ${maxIterations}, convergence threshold: ${convergenceThreshold}\x1b[0m`);
  }
  log("");

  for (let iteration = startIteration; iteration <= maxIterations; iteration++) {
    log(`\x1b[1m━━━ Iteration ${iteration}/${maxIterations} ━━━\x1b[0m`);

    // Load previous state
    const prevState = iteration > 1 ? loadPreviousIterationState(iteration - 1) : null;
    const prevNarrative = iteration > 1 ? loadPreviousNarrative(iteration - 1) : null;

    // Check convergence
    if (!isConverging(runState.iterations, convergenceThreshold)) {
      log(`\x1b[33m⚠ Build loop stalled — remaining items unchanged for ${convergenceThreshold} iterations\x1b[0m`);
      runState.status = "stalled";
      saveGoalState(runState, stateFile);
      break;
    }

    // Build and run prompt
    const prompt = buildIterationPrompt(goal, iteration, prevState, prevNarrative);
    progress.start(`Iteration ${iteration}`);

    try {
      const { result } = await runClaudePrompt(prompt, goal, log, progress);
      progress.stop();

      if (!result) {
        log(`\x1b[31m✗ No output from build agent\x1b[0m`);
        continue;
      }

      // Parse output
      const { state: iterState, narrative } = parseIterationOutput(result, iteration);

      // Persist
      saveIterationState(iteration, iterState);
      saveIterationNarrative(iteration, narrative);
      runState.iterations.push(iterState);
      runState.timestamp = new Date().toISOString();
      saveGoalState(runState, stateFile);

      // Summary
      log(`\x1b[32m✓ Iteration ${iteration} complete\x1b[0m`);
      log(`  Completed: ${iterState.completed_items.length} items`);
      log(`  Remaining: ${iterState.remaining_items.length} items`);
      if (iterState.known_issues.length > 0) {
        log(`  Issues: ${iterState.known_issues.length}`);
      }

      // Check if agent reports done
      if (iterState.agent_done) {
        log(`\n\x1b[36m◆ Build agent reports goal is met — running final gate...\x1b[0m\n`);
        break;
      }

    } catch (e) {
      progress.stop();
      const error = e as Error;
      log(`\x1b[31m✗ Iteration ${iteration} failed: ${error.message}\x1b[0m`);

      if (error.message === "TIMEOUT") {
        log(`\x1b[33m  Continuing to next iteration...\x1b[0m`);
        continue;
      }
      // For non-timeout errors, still continue
      continue;
    }

    log("");
  }

  // --- Final gate ---
  if (runState.status === "running") {
    const maxGateAttempts = 3;

    for (let gateAttempt = 1; gateAttempt <= maxGateAttempts; gateAttempt++) {
      log(`\x1b[1m━━━ Final Gate (attempt ${gateAttempt}/${maxGateAttempts}) ━━━\x1b[0m`);

      const gatePrompt = buildGatePrompt(goal, runState.iterations);

      // Gate agent needs Bash for running verification commands
      const gateGoalConfig: GoalConfig = {
        ...goal,
        defaults: {
          ...goal.defaults,
          allowed_tools: [...(goal.defaults?.allowed_tools ?? DEFAULT_TOOLS), "Bash"],
        },
      };

      progress.start("Running final gate");

      try {
        const { result } = await runClaudePrompt(gatePrompt, gateGoalConfig, log, progress);
        progress.stop();

        if (!result) {
          log(`\x1b[31m✗ No output from gate agent\x1b[0m`);
          continue;
        }

        const gateResult = parseGateOutput(result);
        runState.gate_results.push(gateResult);
        saveGoalState(runState, stateFile);

        if (gateResult.passed) {
          log(`\x1b[32m✓ GATE PASSED\x1b[0m`);
          log(`  ${gateResult.summary}`);
          for (const check of gateResult.checks) {
            const icon = check.passed ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
            log(`  ${icon} ${check.name}`);
          }
          runState.status = "gate_passed";
          saveGoalState(runState, stateFile);
          break;
        } else {
          log(`\x1b[31m✗ GATE FAILED\x1b[0m`);
          log(`  ${gateResult.summary}`);
          for (const failure of gateResult.failures) {
            log(`  \x1b[31m- ${failure}\x1b[0m`);
          }

          if (gateAttempt < maxGateAttempts) {
            // Loop back to build agent with gate failures
            log(`\n\x1b[36m◆ Looping back to build agent with gate failures...\x1b[0m\n`);

            const fixIteration = runState.iterations.length + 1;
            const fixPrompt = buildGateFixPrompt(goal, gateResult, fixIteration);

            progress.start(`Fix iteration ${fixIteration}`);
            try {
              const { result: fixResult } = await runClaudePrompt(fixPrompt, goal, log, progress);
              progress.stop();

              if (fixResult) {
                const { state: fixState, narrative: fixNarrative } = parseIterationOutput(fixResult, fixIteration);
                saveIterationState(fixIteration, fixState);
                saveIterationNarrative(fixIteration, fixNarrative);
                runState.iterations.push(fixState);
                saveGoalState(runState, stateFile);

                log(`\x1b[32m✓ Fix iteration complete\x1b[0m`);
                log(`  Fixed: ${fixState.completed_items.length} items`);
              }
            } catch (e) {
              progress.stop();
              log(`\x1b[31m✗ Fix iteration failed: ${(e as Error).message}\x1b[0m`);
            }
          } else {
            runState.status = "gate_failed";
            saveGoalState(runState, stateFile);
          }
        }
      } catch (e) {
        progress.stop();
        log(`\x1b[31m✗ Gate failed: ${(e as Error).message}\x1b[0m`);
      }

      log("");
    }
  }

  // Check if we exhausted iterations without the agent reporting done
  if (runState.status === "running") {
    const lastState = runState.iterations[runState.iterations.length - 1];
    if (!lastState?.agent_done) {
      log(`\x1b[33m⚠ Reached max iterations (${maxIterations}) without completion\x1b[0m`);
      runState.status = "max_iterations";
      saveGoalState(runState, stateFile);
    }
  }

  return runState;
}

function buildGateFixPrompt(goal: GoalConfig, gateResult: GateResult, iteration: number): string {
  return `# Goal

${goal.goal}

# Urgent: Fix Gate Failures

The final verification gate FAILED. You must fix these issues:

## Failures

${gateResult.failures.map((f) => `- ${f}`).join("\n")}

## Check Results

${gateResult.checks.map((c) => `- ${c.passed ? "PASS" : "FAIL"}: ${c.name} — ${c.output}`).join("\n")}

## Gate Summary

${gateResult.summary}

# Instructions

Fix ALL of the failures listed above. Focus exclusively on making the gate pass. Do not add new features.

When done, output your state update:

\`\`\`yaml
completed_items:
  - "fixed: description of what you fixed"
remaining_items:
  - "any remaining issues"
known_issues:
  - "any issues you could not fix"
files_modified:
  - "path/to/file.ts"
agent_done: true
\`\`\`

Then write a brief summary of what you fixed.`;
}

// --- Goal file parsing ---

export function parseGoalFile(path: string): GoalConfig {
  const content = readFileSync(path, "utf-8");
  let data: GoalConfig;
  try {
    data = parseYaml(content) as GoalConfig;
  } catch (e) {
    const error = e as Error;
    console.error(`\x1b[31mError parsing ${path}:\x1b[0m`);
    console.error(`  ${error.message.split("\n")[0]}`);
    process.exit(1);
  }

  if (!data.goal) {
    console.error(`\x1b[31mError: goal.yaml must have a 'goal' field\x1b[0m`);
    process.exit(1);
  }

  return data;
}
