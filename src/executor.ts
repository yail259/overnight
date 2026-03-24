/**
 * Adaptive executor — predict one → execute → observe → predict next.
 * All messages run on a single branch (overnight/{run-id}), sequential commits.
 */

import { execSync, spawn } from "child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import type {
  PredictedMessage,
  ExecutionResult,
  OvernightRun,
  OvernightConfig,
  AdaptiveContext,
  RunMode,
  AmbitionLevel,
} from "./types.js";
import { RUNS_DIR } from "./types.js";
import { updateProfile, extractDirection } from "./profile.js";
import { predictNext } from "./predictor.js";
import { recordRunOutcome } from "./meta-learning.js";
import { generateWorkspaceDump, saveWorkspaceDump } from "./context.js";

// ── Branch management ────────────────────────────────────────────────

/** Create and checkout the run branch */
function setupRunBranch(cwd: string, branchName: string): void {
  try {
    // Create branch from current HEAD
    execSync(`git checkout -b ${branchName}`, { cwd, stdio: "pipe", timeout: 10_000 });
  } catch {
    // Branch might already exist (resumed run)
    try {
      execSync(`git checkout ${branchName}`, { cwd, stdio: "pipe", timeout: 10_000 });
    } catch {
      // If even checkout fails, we're in trouble but continue anyway
    }
  }
}

/** Return to the original branch */
function restoreBranch(cwd: string, baseBranch: string): void {
  try {
    execSync(`git checkout ${baseBranch}`, { cwd, stdio: "pipe", timeout: 10_000 });
  } catch {
    // Best effort
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Check if tests pass in a directory */
function checkTests(cwd: string): boolean {
  try {
    execSync("npm test --if-present 2>&1", { cwd, timeout: 120_000, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/** Check if build passes in a directory */
function checkBuild(cwd: string): boolean {
  try {
    execSync("npm run build --if-present 2>&1", { cwd, timeout: 120_000, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/** Get git diff --stat for uncommitted changes */
function getDiffStat(cwd: string): string {
  try {
    return execSync("git diff --stat", {
      cwd, stdio: "pipe", timeout: 5_000,
    }).toString().trim();
  } catch {
    return "";
  }
}

/** Auto-commit all changes on the run branch after each step */
function autoCommit(cwd: string, message: string, stepIndex: number): void {
  try {
    // Stage everything
    execSync("git add -A", { cwd, stdio: "pipe", timeout: 10_000 });
    // Check if there's anything to commit
    const status = execSync("git status --porcelain", { cwd, stdio: "pipe", timeout: 5_000 }).toString().trim();
    if (!status) return; // nothing to commit
    const commitMsg = `overnight step ${stepIndex + 1}: ${message.slice(0, 72)}`;
    execSync(`git commit -m ${JSON.stringify(commitMsg)}`, { cwd, stdio: "pipe", timeout: 10_000 });
  } catch {
    // Best effort — don't fail the run over a commit issue
  }
}

/** Extract cost from claude stream-json output */
function extractCost(output: string): number {
  let totalCost = 0;
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "result" && event.cost_usd != null) {
        totalCost = event.cost_usd;
      }
    } catch {
      // skip non-JSON lines
    }
  }
  return totalCost;
}

/** Run a single predicted message via claude CLI (on current branch, no worktree) */
export async function executeMessage(
  prediction: PredictedMessage,
  cwd: string,
  config: OvernightConfig,
  branch: string,
  stepIndex: number
): Promise<ExecutionResult> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const args = [
      "-p", prediction.message,
      "--output-format", "stream-json",
      "--permission-mode", "auto",
      "--verbose",
    ];

    let output = "";

    const proc = spawn(config.claudeBin, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    proc.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      output += data.toString();
    });

    proc.on("close", (code) => {
      const durationSeconds = Math.round((Date.now() - startTime) / 1000);
      const costUsd = extractCost(output);
      const diff = getDiffStat(cwd); // capture before commit
      const testsPass = checkTests(cwd);
      const buildPass = checkBuild(cwd);

      // Auto-commit changes so git state stays clean for the next prediction
      autoCommit(cwd, prediction.message, stepIndex);

      resolve({
        message: prediction.message,
        branch,
        exitCode: code ?? 1,
        output: output.slice(-5000), // keep last 5KB
        diff,
        testsPass,
        buildPass,
        costUsd,
        durationSeconds,
        timestamp: new Date().toISOString(),
      });
    });

    proc.on("error", (err) => {
      resolve({
        message: prediction.message,
        branch,
        exitCode: 1,
        output: err.message,
        diff: "",
        testsPass: false,
        buildPass: false,
        costUsd: 0,
        durationSeconds: Math.round((Date.now() - startTime) / 1000),
        timestamp: new Date().toISOString(),
      });
    });
  });
}

// ── Callbacks ────────────────────────────────────────────────────────

export interface ExecuteCallbacks {
  /** Fired when a message starts executing */
  onStart?: (prediction: PredictedMessage, index: number) => void;
  /** Fired when a message finishes executing */
  onProgress?: (result: ExecutionResult, index: number) => void;
  /** Fired when predictor decides next step (or done) */
  onPrediction?: (prediction: PredictedMessage | null, reasoning: string, index: number) => void;
}

// ── Adaptive execution loop ──────────────────────────────────────────

export async function executeAll(
  run: OvernightRun,
  config: OvernightConfig,
  callbacks?: ExecuteCallbacks
): Promise<OvernightRun> {
  const cb = callbacks ?? {};

  // Ensure runs directory exists
  mkdirSync(RUNS_DIR, { recursive: true });
  const runFile = join(RUNS_DIR, `${run.id}.json`);

  // Save workspace dump for this run (debugging: "why did it suggest X?")
  try {
    const dump = generateWorkspaceDump(run.cwd);
    saveWorkspaceDump(run.id, dump);
  } catch {}

  // Setup run branch
  setupRunBranch(run.cwd, run.branch);

  // Extract user direction once at run start — feeds all predictions
  const direction = await extractDirection(run.cwd, config);

  const adaptiveContext: AdaptiveContext = {
    completedSteps: [],
    mode: run.mode,
    ambition: "normal", // will be overridden
    goals: run.predictions.map((p) => p.message), // initial predictions serve as goals
    direction,
  };

  let stepIndex = 0;

  // Execute initial predictions first (if any from preview), then switch to adaptive
  // For adaptive: we use predictNext to get each message
  const maxSteps = config.maxMessages; // safety cap

  while (stepIndex < maxSteps) {
    // Check if we've been stopped
    const current = readRunFile(runFile);
    if (current?.status === "stopped") {
      run.status = "stopped";
      break;
    }

    let prediction: PredictedMessage;

    if (stepIndex === 0 && run.predictions.length > 0) {
      // First step: use the first prediction from preview (already have it)
      prediction = run.predictions[0];
    } else {
      // Adaptive: ask predictor for next step
      const nextResult = await predictNext(
        run.intent,
        run.cwd,
        config,
        adaptiveContext
      );

      cb.onPrediction?.(nextResult.done ? null : nextResult.prediction!, nextResult.reasoning, stepIndex);

      if (nextResult.done || !nextResult.prediction) {
        // Model says we're done
        break;
      }

      prediction = nextResult.prediction;
      run.predictions.push(prediction); // track what was predicted
    }

    // Execute the message
    cb.onStart?.(prediction, stepIndex);

    const result = await executeMessage(prediction, run.cwd, config, run.branch, stepIndex);

    run.results.push(result);
    adaptiveContext.completedSteps.push({
      message: prediction.message,
      output: result.output,
      diff: result.diff,
      exitCode: result.exitCode,
      testsPass: result.testsPass,
      buildPass: result.buildPass,
    });

    // Save progress after each message
    writeFileSync(runFile, JSON.stringify(run, null, 2));

    cb.onProgress?.(result, stepIndex);

    stepIndex++;

    // In "stick to plan" mode, a non-zero exit code means stop
    // In "dont stop" mode, we continue (predictor will see the failure and adapt)
    if (result.exitCode !== 0 && run.mode === "stick-to-plan") {
      run.status = "failed";
      break;
    }
  }

  if (run.status === "running") {
    run.status = "completed";
  }
  run.finishedAt = new Date().toISOString();
  writeFileSync(runFile, JSON.stringify(run, null, 2));

  // Return to base branch
  restoreBranch(run.cwd, run.baseBranch);

  // Auto-update profile after run (fire and forget)
  updateProfile(config).catch(() => {});

  // Record run outcome for meta-learning
  try {
    recordRunOutcome(run, run.cwd);
  } catch {}

  return run;
}

/** Read a run file if it exists */
function readRunFile(path: string): OvernightRun | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/** Get the latest run */
export function getLatestRun(): OvernightRun | null {
  try {
    if (!existsSync(RUNS_DIR)) return null;
    const { readdirSync, statSync } = require("fs");
    const files = readdirSync(RUNS_DIR)
      .filter((f: string) => f.endsWith(".json"))
      .map((f: string) => join(RUNS_DIR, f))
      .sort((a: string, b: string) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (files.length === 0) return null;
    return JSON.parse(readFileSync(files[0], "utf-8"));
  } catch {
    return null;
  }
}
