import { query, type Options as ClaudeCodeOptions } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { execSync } from "child_process";
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

async function collectResult(
  prompt: string,
  options: ClaudeCodeOptions
): Promise<{ sessionId?: string; result?: string }> {
  let sessionId: string | undefined;
  let result: string | undefined;

  const conversation = query({ prompt, options });

  for await (const message of conversation) {
    if (message.type === "result") {
      result = message.result;
      sessionId = message.session_id;
    }
  }

  return { sessionId, result };
}

export async function runJob(
  config: JobConfig,
  log?: LogCallback
): Promise<JobResult> {
  const startTime = Date.now();
  const tools = config.allowed_tools ?? DEFAULT_TOOLS;
  const timeout = (config.timeout_seconds ?? DEFAULT_TIMEOUT) * 1000;
  const retryCount = config.retry_count ?? DEFAULT_RETRY_COUNT;
  const retryDelay = config.retry_delay ?? DEFAULT_RETRY_DELAY;
  const verifyPrompt = config.verify_prompt ?? DEFAULT_VERIFY_PROMPT;
  let retriesUsed = 0;

  const logMsg = (msg: string) => log?.(msg);

  // Find claude executable once at start
  const claudePath = findClaudeExecutable();
  if (!claudePath) {
    logMsg("\x1b[31mError: Could not find 'claude' CLI.\x1b[0m");
    logMsg("\x1b[33mInstall it with:\x1b[0m");
    logMsg("  curl -fsSL https://claude.ai/install.sh | bash");
    logMsg("\x1b[33mOr set CLAUDE_CODE_PATH environment variable.\x1b[0m");
    return {
      task: config.prompt,
      status: "failed",
      error: "Claude CLI not found. Install with: curl -fsSL https://claude.ai/install.sh | bash",
      duration_seconds: 0,
      verified: false,
      retries: 0,
    };
  }

  logMsg(`Starting: ${config.prompt.slice(0, 60)}...`);

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      // Build security hooks if security config provided
      const securityHooks = config.security ? createSecurityHooks(config.security) : undefined;

      const options: ClaudeCodeOptions = {
        allowedTools: tools,
        permissionMode: "acceptEdits",
        ...(claudePath && { pathToClaudeCodeExecutable: claudePath }),
        ...(config.working_dir && { cwd: config.working_dir }),
        ...(config.security?.max_turns && { maxTurns: config.security.max_turns }),
        ...(securityHooks && { hooks: securityHooks }),
      };

      let sessionId: string | undefined;
      let result: string | undefined;

      try {
        const collected = await runWithTimeout(
          collectResult(config.prompt, options),
          timeout
        );
        sessionId = collected.sessionId;
        result = collected.result;
      } catch (e) {
        if ((e as Error).message === "TIMEOUT") {
          if (attempt < retryCount) {
            retriesUsed = attempt + 1;
            const delay = retryDelay * Math.pow(2, attempt);
            logMsg(
              `Timeout after ${config.timeout_seconds ?? DEFAULT_TIMEOUT}s, retrying in ${delay}s (attempt ${attempt + 1}/${retryCount})...`
            );
            await sleep(delay * 1000);
            continue;
          }
          logMsg(
            `Timeout after ${config.timeout_seconds ?? DEFAULT_TIMEOUT}s (exhausted retries)`
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

      // Verification pass if enabled
      if (config.verify !== false && sessionId) {
        logMsg("Running verification...");

        const verifyOptions: ClaudeCodeOptions = {
          resume: sessionId,
          permissionMode: "acceptEdits",
        };

        try {
          const verifyResult = await runWithTimeout(
            collectResult(verifyPrompt, verifyOptions),
            timeout / 2
          );

          const issueWords = ["issue", "error", "fail", "incorrect", "missing"];
          if (
            verifyResult.result &&
            issueWords.some((word) =>
              verifyResult.result!.toLowerCase().includes(word)
            )
          ) {
            logMsg("Verification found potential issues");
            return {
              task: config.prompt,
              status: "verification_failed",
              result,
              error: `Verification issues: ${verifyResult.result}`,
              duration_seconds: (Date.now() - startTime) / 1000,
              verified: false,
              retries: retriesUsed,
            };
          }
        } catch (e) {
          if ((e as Error).message === "TIMEOUT") {
            logMsg("Verification timed out - continuing anyway");
          } else {
            throw e;
          }
        }
      }

      const duration = (Date.now() - startTime) / 1000;
      logMsg(`Completed in ${duration.toFixed(1)}s`);

      return {
        task: config.prompt,
        status: "success",
        result,
        duration_seconds: duration,
        verified: config.verify !== false,
        retries: retriesUsed,
      };
    } catch (e) {
      const error = e as Error;
      if (isRetryableError(error) && attempt < retryCount) {
        retriesUsed = attempt + 1;
        const delay = retryDelay * Math.pow(2, attempt);
        logMsg(
          `Retryable error: ${error.message}, retrying in ${delay}s (attempt ${attempt + 1}/${retryCount})...`
        );
        await sleep(delay * 1000);
        continue;
      }

      const duration = (Date.now() - startTime) / 1000;
      logMsg(`Failed: ${error.message}`);
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
    startIndex?: number;
    priorResults?: JobResult[];
  } = {}
): Promise<JobResult[]> {
  const stateFile = options.stateFile ?? DEFAULT_STATE_FILE;
  const results: JobResult[] = options.priorResults
    ? [...options.priorResults]
    : [];
  const startIndex = options.startIndex ?? 0;

  for (let i = 0; i < configs.length; i++) {
    if (i < startIndex) continue;

    options.log?.(`\n[${i + 1}/${configs.length}] Running job...`);

    const result = await runJob(configs[i], options.log);
    results.push(result);

    // Save state after each job
    const state: RunState = {
      completed_indices: Array.from({ length: results.length }, (_, i) => i),
      results,
      timestamp: new Date().toISOString(),
      total_jobs: configs.length,
    };
    saveState(state, stateFile);

    // Brief pause between jobs
    if (i < configs.length - 1) {
      await sleep(1000);
    }
  }

  // Clean up state file on completion
  clearState(stateFile);

  return results;
}

export function resultsToJson(results: JobResult[]): string {
  return JSON.stringify(results, null, 2);
}
