import { query, type Options as ClaudeCodeOptions } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { createHash } from "crypto";
import {
  type JobConfig,
  type JobResult,
  type RunState,
  DEFAULT_TOOLS,
  DEFAULT_TIMEOUT,
  DEFAULT_RETRY_COUNT,
  DEFAULT_RETRY_DELAY,
  DEFAULT_VERIFY_PROMPT,
  DEFAULT_STATE_FILE,
  DEFAULT_MAX_TURNS,
} from "./types.js";
import { createSecurityHooks } from "./security.js";

type LogCallback = (msg: string) => void;
type ProgressCallback = (activity: string) => void;

// Progress display
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

class ProgressDisplay {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private startTime = Date.now();
  private currentActivity = "Working";
  private lastToolUse = "";

  start(activity: string): void {
    this.currentActivity = activity;
    this.startTime = Date.now();
    this.frame = 0;

    if (this.interval) return;

    this.interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
      const toolInfo = this.lastToolUse ? ` → ${this.lastToolUse}` : "";
      process.stdout.write(
        `\r\x1b[K${SPINNER_FRAMES[this.frame]} ${this.currentActivity} (${elapsed}s)${toolInfo}`
      );
      this.frame = (this.frame + 1) % SPINNER_FRAMES.length;
    }, 100);
  }

  updateActivity(activity: string): void {
    this.currentActivity = activity;
  }

  updateTool(toolName: string, detail?: string): void {
    this.lastToolUse = detail ? `${toolName}: ${detail}` : toolName;
  }

  stop(finalMessage?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write("\r\x1b[K"); // Clear line
    if (finalMessage) {
      console.log(finalMessage);
    }
  }

  getElapsed(): number {
    return (Date.now() - this.startTime) / 1000;
  }
}

// Cache the claude executable path
let claudeExecutablePath: string | undefined;

function findClaudeExecutable(): string | undefined {
  if (claudeExecutablePath !== undefined) return claudeExecutablePath;

  // Check environment variable first
  if (process.env.CLAUDE_CODE_PATH) {
    claudeExecutablePath = process.env.CLAUDE_CODE_PATH;
    return claudeExecutablePath;
  }

  // Try to find claude using which/where
  try {
    const cmd = process.platform === "win32" ? "where claude" : "which claude";
    claudeExecutablePath = execSync(cmd, { encoding: "utf-8" }).trim().split("\n")[0];
    return claudeExecutablePath;
  } catch {
    // Fall back to common locations
    const commonPaths = [
      "/usr/local/bin/claude",
      "/opt/homebrew/bin/claude",
      `${process.env.HOME}/.local/bin/claude`,
      `${process.env.HOME}/.nvm/versions/node/v22.12.0/bin/claude`,
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

function isRetryableError(error: Error): boolean {
  const errorStr = error.message.toLowerCase();
  const retryablePatterns = [
    "api",
    "timeout",
    "connection",
    "network",
    "rate limit",
    "503",
    "502",
    "500",
    "unavailable",
    "overloaded",
  ];
  return retryablePatterns.some((pattern) => errorStr.includes(pattern));
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timeoutId: Timer;
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

// Extract useful info from tool input for display
function getToolDetail(toolName: string, toolInput: Record<string, unknown>): string {
  switch (toolName) {
    case "Read":
    case "Write":
    case "Edit":
      const filePath = toolInput.file_path as string;
      if (filePath) {
        // Show just filename, not full path
        return filePath.split("/").pop() || filePath;
      }
      break;
    case "Glob":
      return (toolInput.pattern as string) || "";
    case "Grep":
      return (toolInput.pattern as string)?.slice(0, 20) || "";
    case "Bash":
      const cmd = (toolInput.command as string) || "";
      return cmd.slice(0, 30) + (cmd.length > 30 ? "..." : "");
  }
  return "";
}

async function collectResultWithProgress(
  prompt: string,
  options: ClaudeCodeOptions,
  progress: ProgressDisplay,
  onSessionId?: (sessionId: string) => void
): Promise<{ sessionId?: string; result?: string; error?: string }> {
  let sessionId: string | undefined;
  let result: string | undefined;
  let lastError: string | undefined;

  try {
    const conversation = query({ prompt, options });

    for await (const message of conversation) {
      // Debug logging
      if (process.env.OVERNIGHT_DEBUG) {
        console.error(`\n[DEBUG] message.type=${message.type}, keys=${Object.keys(message).join(",")}`);
      }

      // Handle different message types
      if (message.type === "result") {
        result = message.result;
        sessionId = message.session_id;
      } else if (message.type === "assistant" && "message" in message) {
        // Assistant message with tool use - SDK nests content in message.message
        const assistantMsg = message.message as { content?: Array<{ type: string; name?: string; input?: Record<string, unknown> }> };
        if (assistantMsg.content) {
          for (const block of assistantMsg.content) {
            if (process.env.OVERNIGHT_DEBUG) {
              console.error(`[DEBUG] content block: type=${block.type}, name=${block.name}`);
            }
            if (block.type === "tool_use" && block.name) {
              const detail = block.input ? getToolDetail(block.name, block.input) : "";
              progress.updateTool(block.name, detail);
            }
          }
        }
      } else if (message.type === "system" && "subtype" in message) {
        // System messages
        if (message.subtype === "init") {
          sessionId = message.session_id;
          if (sessionId && onSessionId) {
            onSessionId(sessionId);
          }
        }
      }
    }
  } catch (e) {
    lastError = (e as Error).message;
    throw e;
  }

  return { sessionId, result, error: lastError };
}

export async function runJob(
  config: JobConfig,
  log?: LogCallback,
  options?: {
    resumeSessionId?: string;        // Resume from a previous session
    onSessionId?: (id: string) => void;  // Called when session ID is available
  }
): Promise<JobResult> {
  const startTime = Date.now();
  const tools = config.allowed_tools ?? DEFAULT_TOOLS;
  const timeout = (config.timeout_seconds ?? DEFAULT_TIMEOUT) * 1000;
  const retryCount = config.retry_count ?? DEFAULT_RETRY_COUNT;
  const retryDelay = config.retry_delay ?? DEFAULT_RETRY_DELAY;
  const verifyPrompt = config.verify_prompt ?? DEFAULT_VERIFY_PROMPT;
  let retriesUsed = 0;
  let resumeSessionId = options?.resumeSessionId;

  const logMsg = (msg: string) => log?.(msg);
  const progress = new ProgressDisplay();

  // Find claude executable once at start
  const claudePath = findClaudeExecutable();
  if (!claudePath) {
    logMsg("\x1b[31m✗ Error: Could not find 'claude' CLI.\x1b[0m");
    logMsg("\x1b[33m  Install it with:\x1b[0m");
    logMsg("    curl -fsSL https://claude.ai/install.sh | bash");
    logMsg("\x1b[33m  Or set CLAUDE_CODE_PATH environment variable.\x1b[0m");
    return {
      task: config.prompt,
      status: "failed",
      error: "Claude CLI not found. Install with: curl -fsSL https://claude.ai/install.sh | bash",
      duration_seconds: 0,
      verified: false,
      retries: 0,
    };
  }

  if (process.env.OVERNIGHT_DEBUG) {
    logMsg(`\x1b[2mDebug: Claude path = ${claudePath}\x1b[0m`);
  }

  // Show task being started
  const taskPreview = config.prompt.slice(0, 60) + (config.prompt.length > 60 ? "..." : "");
  if (resumeSessionId) {
    logMsg(`\x1b[36m▶\x1b[0m Resuming: ${taskPreview}`);
  } else {
    logMsg(`\x1b[36m▶\x1b[0m ${taskPreview}`);
  }

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      // Build security hooks if security config provided
      const securityHooks = config.security ? createSecurityHooks(config.security) : undefined;

      const sdkOptions: ClaudeCodeOptions = {
        allowedTools: tools,
        permissionMode: "acceptEdits",
        ...(claudePath && { pathToClaudeCodeExecutable: claudePath }),
        ...(config.working_dir && { cwd: config.working_dir }),
        ...(config.security?.max_turns && { maxTurns: config.security.max_turns }),
        ...(securityHooks && { hooks: securityHooks }),
        ...(resumeSessionId && { resume: resumeSessionId }),
      };

      let sessionId: string | undefined;
      let result: string | undefined;

      // Prompt: if resuming, ask to continue; otherwise use original prompt
      const prompt = resumeSessionId
        ? "Continue where you left off. Complete the original task."
        : config.prompt;

      // Start progress display
      progress.start(resumeSessionId ? "Resuming" : "Working");

      try {
        const collected = await runWithTimeout(
          collectResultWithProgress(prompt, sdkOptions, progress, (id) => {
            sessionId = id;
            options?.onSessionId?.(id);
          }),
          timeout
        );
        sessionId = collected.sessionId;
        result = collected.result;
        progress.stop();
      } catch (e) {
        progress.stop();
        if ((e as Error).message === "TIMEOUT") {
          if (attempt < retryCount) {
            retriesUsed = attempt + 1;
            // On timeout, if we have a session ID, use it for the retry
            if (sessionId) {
              resumeSessionId = sessionId;
            }
            const delay = retryDelay * Math.pow(2, attempt);
            logMsg(
              `\x1b[33m⚠ Timeout after ${config.timeout_seconds ?? DEFAULT_TIMEOUT}s, retrying in ${delay}s (${attempt + 1}/${retryCount})\x1b[0m`
            );
            await sleep(delay * 1000);
            continue;
          }
          logMsg(
            `\x1b[31m✗ Timeout after ${config.timeout_seconds ?? DEFAULT_TIMEOUT}s (exhausted retries)\x1b[0m`
          );
          return {
            task: config.prompt,
            status: "timeout",
            error: `Timed out after ${config.timeout_seconds ?? DEFAULT_TIMEOUT} seconds`,
            duration_seconds: (Date.now() - startTime) / 1000,
            verified: false,
            retries: retriesUsed,
          };
        }
        throw e;
      }

      // Verification pass if enabled — verify and fix issues
      if (config.verify !== false && sessionId) {
        progress.start("Verifying");

        const verifyOptions: ClaudeCodeOptions = {
          allowedTools: tools,
          resume: sessionId,
          permissionMode: "acceptEdits",
          ...(claudePath && { pathToClaudeCodeExecutable: claudePath }),
          ...(config.working_dir && { cwd: config.working_dir }),
          ...(config.security?.max_turns && { maxTurns: config.security.max_turns }),
        };

        const fixPrompt = verifyPrompt +
          " If you find any issues, fix them now. Only report issues you cannot fix.";

        try {
          const verifyResult = await runWithTimeout(
            collectResultWithProgress(fixPrompt, verifyOptions, progress, (id) => {
              sessionId = id;
              options?.onSessionId?.(id);
            }),
            timeout / 2
          );
          progress.stop();

          // Update result with verification output
          if (verifyResult.result) {
            result = verifyResult.result;
          }

          // Only mark as failed if there are issues that couldn't be fixed
          const unfixableWords = ["cannot fix", "unable to", "blocked by", "requires manual"];
          if (
            verifyResult.result &&
            unfixableWords.some((word) =>
              verifyResult.result!.toLowerCase().includes(word)
            )
          ) {
            logMsg(`\x1b[33m⚠ Verification found unfixable issues\x1b[0m`);
            return {
              task: config.prompt,
              status: "verification_failed",
              result,
              error: `Unfixable issues: ${verifyResult.result}`,
              duration_seconds: (Date.now() - startTime) / 1000,
              verified: false,
              retries: retriesUsed,
            };
          }
        } catch (e) {
          progress.stop();
          if ((e as Error).message === "TIMEOUT") {
            logMsg("\x1b[33m⚠ Verification timed out - continuing anyway\x1b[0m");
          } else {
            throw e;
          }
        }
      }

      const duration = (Date.now() - startTime) / 1000;
      logMsg(`\x1b[32m✓ Completed in ${duration.toFixed(1)}s\x1b[0m`);

      return {
        task: config.prompt,
        status: "success",
        result,
        duration_seconds: duration,
        verified: config.verify !== false,
        retries: retriesUsed,
      };
    } catch (e) {
      progress.stop();
      const error = e as Error;
      if (isRetryableError(error) && attempt < retryCount) {
        retriesUsed = attempt + 1;
        // Preserve session for resumption on retry
        if (sessionId) {
          resumeSessionId = sessionId;
        }
        const delay = retryDelay * Math.pow(2, attempt);
        logMsg(
          `\x1b[33m⚠ ${error.message}, retrying in ${delay}s (${attempt + 1}/${retryCount})\x1b[0m`
        );
        await sleep(delay * 1000);
        continue;
      }

      const duration = (Date.now() - startTime) / 1000;
      logMsg(`\x1b[31m✗ Failed: ${error.message}\x1b[0m`);
      return {
        task: config.prompt,
        status: "failed",
        error: error.message,
        duration_seconds: duration,
        verified: false,
        retries: retriesUsed,
      };
    }
  }

  // Should not reach here
  return {
    task: config.prompt,
    status: "failed",
    error: "Exhausted all retries",
    duration_seconds: (Date.now() - startTime) / 1000,
    verified: false,
    retries: retriesUsed,
  };
}

export function taskHash(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 12);
}

export function saveState(state: RunState, stateFile: string): void {
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

export function loadState(stateFile: string): RunState | null {
  if (!existsSync(stateFile)) return null;
  return JSON.parse(readFileSync(stateFile, "utf-8"));
}

export function clearState(stateFile: string): void {
  if (existsSync(stateFile)) unlinkSync(stateFile);
}

export async function runJobsWithState(
  configs: JobConfig[],
  options: {
    stateFile?: string;
    log?: LogCallback;
    reloadConfigs?: () => JobConfig[];  // Called between jobs to pick up new tasks
  } = {}
): Promise<JobResult[]> {
  const stateFile = options.stateFile ?? DEFAULT_STATE_FILE;

  // Load existing state or start fresh
  const state: RunState = loadState(stateFile) ?? {
    completed: {},
    timestamp: new Date().toISOString(),
  };

  let currentConfigs = configs;
  let jobNum = 0;

  while (true) {
    // Find next task that hasn't been completed
    const pending = currentConfigs.filter(c => !(taskHash(c.prompt) in state.completed));

    if (pending.length === 0) break;

    const config = pending[0];
    const hash = taskHash(config.prompt);
    jobNum++;

    const totalPending = pending.length;
    const totalDone = Object.keys(state.completed).length;
    options.log?.(`\n\x1b[1m[${totalDone + 1}/${totalDone + totalPending}]\x1b[0m`);

    // Check if this task was previously in-progress (crashed mid-task)
    const resumeSessionId = (state.inProgress?.hash === hash)
      ? state.inProgress.sessionId
      : undefined;

    if (resumeSessionId) {
      options.log?.(`\x1b[2mResuming session ${resumeSessionId.slice(0, 8)}...\x1b[0m`);
    }

    // Mark task as in-progress before starting
    state.inProgress = { hash, prompt: config.prompt, startedAt: new Date().toISOString() };
    saveState(state, stateFile);

    const result = await runJob(config, options.log, {
      resumeSessionId,
      onSessionId: (id) => {
        // Checkpoint the session ID so we can resume on crash
        state.inProgress = { hash, prompt: config.prompt, sessionId: id, startedAt: state.inProgress!.startedAt };
        saveState(state, stateFile);
      },
    });

    // Task done — save result and clear in-progress
    state.completed[hash] = result;
    state.inProgress = undefined;
    state.timestamp = new Date().toISOString();
    saveState(state, stateFile);

    // Re-read YAML to pick up new tasks added while running
    if (options.reloadConfigs) {
      try {
        currentConfigs = options.reloadConfigs();
      } catch {
        // If reload fails (e.g. YAML syntax error mid-edit), keep current list
      }
    }

    // Brief pause between jobs
    const nextPending = currentConfigs.filter(c => !(taskHash(c.prompt) in state.completed));
    if (nextPending.length > 0) {
      await sleep(1000);
    }
  }

  // Collect results in original order
  const results = currentConfigs
    .map(c => state.completed[taskHash(c.prompt)])
    .filter((r): r is JobResult => r !== undefined);

  // Clean up state file on completion
  clearState(stateFile);

  return results;
}

export function resultsToJson(results: JobResult[]): string {
  return JSON.stringify(results, null, 2);
}
