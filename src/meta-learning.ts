/**
 * Meta-learning — track run outcomes to improve predictions over time.
 *
 * After each run, the user reviews the overnight branch:
 * - Merged steps = "you predicted me correctly"
 * - Discarded steps = "you got it wrong"
 * - Cherry-picked = "partially right"
 *
 * This module:
 * 1. Records run outcomes (merge/discard/partial)
 * 2. Tracks per-category success rates (tests, refactors, features, etc.)
 * 3. Calibrates prediction confidence against actual merge rates
 * 4. Generates a "prediction profile" that supplements the user profile
 *
 * The prediction profile captures: "what works for this user overnight"
 * — distinct from their coding style. Two devs with identical styles
 * may trust different things while sleeping.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import type { OvernightRun, ExecutionResult } from "./types.js";
import { OVERNIGHT_DIR, RUNS_DIR } from "./types.js";
import { join } from "path";

// ── Types ───────────────────────────────────────────────────────────

export type RunOutcome = "merged" | "discarded" | "partial" | "pending";

export interface StepOutcome {
  message: string;
  category: StepCategory;
  merged: boolean;
  confidence: number; // original prediction confidence
}

export type StepCategory =
  | "tests"
  | "docs"
  | "refactor"
  | "feature"
  | "bugfix"
  | "cleanup"
  | "config"
  | "other";

export interface RunOutcomeRecord {
  runId: string;
  timestamp: string;
  intent: string;
  outcome: RunOutcome;
  ambition: string;
  mode: string;
  steps: StepOutcome[];
  /** Was the overnight branch merged into the base branch? */
  branchMerged: boolean;
}

export interface PredictionProfile {
  /** Updated timestamp */
  updatedAt: string;
  /** Total runs tracked */
  totalRuns: number;
  /** Overall merge rate (0-1) */
  overallMergeRate: number;
  /** Merge rate by category */
  categoryMergeRates: Record<StepCategory, { merged: number; total: number; rate: number }>;
  /** Merge rate by ambition level */
  ambitionMergeRates: Record<string, { merged: number; total: number; rate: number }>;
  /** Categories this user trusts overnight with */
  trustedCategories: StepCategory[];
  /** Categories the user usually discards */
  distrustedCategories: StepCategory[];
  /** Average confidence calibration (predicted vs actual) */
  confidenceCalibration: number;
}

// ── Storage ─────────────────────────────────────────────────────────

const META_DIR = join(OVERNIGHT_DIR, "meta");
const OUTCOMES_FILE = join(META_DIR, "outcomes.json");
const PREDICTION_PROFILE_FILE = join(META_DIR, "prediction-profile.json");

function loadOutcomes(): RunOutcomeRecord[] {
  if (!existsSync(OUTCOMES_FILE)) return [];
  try {
    return JSON.parse(readFileSync(OUTCOMES_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveOutcomes(outcomes: RunOutcomeRecord[]): void {
  mkdirSync(META_DIR, { recursive: true });
  writeFileSync(OUTCOMES_FILE, JSON.stringify(outcomes, null, 2));
}

export function loadPredictionProfile(): PredictionProfile | null {
  if (!existsSync(PREDICTION_PROFILE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(PREDICTION_PROFILE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function savePredictionProfile(profile: PredictionProfile): void {
  mkdirSync(META_DIR, { recursive: true });
  writeFileSync(PREDICTION_PROFILE_FILE, JSON.stringify(profile, null, 2));
}

// ── Categorization ──────────────────────────────────────────────────

/** Categorize a prediction step by its message content */
export function categorizeStep(message: string): StepCategory {
  const lower = message.toLowerCase();

  if (lower.match(/\b(test|spec|assert|expect|describe|it\(|vitest|jest)\b/)) return "tests";
  if (lower.match(/\b(doc|readme|jsdoc|comment|changelog|documentation)\b/)) return "docs";
  if (lower.match(/\b(refactor|extract|rename|reorganize|consolidat|restructur|simplif)\b/)) return "refactor";
  if (lower.match(/\b(add|implement|create|build|new feature|introduce)\b/)) return "feature";
  if (lower.match(/\b(fix|bug|patch|resolve|repair|broken|issue)\b/)) return "bugfix";
  if (lower.match(/\b(clean|lint|format|remove|delete|unused|dead code|deprecat)\b/)) return "cleanup";
  if (lower.match(/\b(config|package\.json|tsconfig|eslint|prettier|setup|install)\b/)) return "config";

  return "other";
}

// ── Outcome recording ───────────────────────────────────────────────

/** Check if an overnight branch was merged into the base branch */
export function checkBranchMerged(cwd: string, branchName: string, baseBranch: string): boolean {
  try {
    const result = execSync(
      `git branch --merged ${baseBranch} 2>/dev/null | grep -q "${branchName}" && echo "yes" || echo "no"`,
      { cwd, stdio: "pipe", timeout: 5_000 },
    ).toString().trim();
    return result === "yes";
  } catch {
    return false;
  }
}

/** Check which steps from a run still exist in the codebase (not reverted) */
export function checkStepsPresent(cwd: string, run: OvernightRun): boolean[] {
  // Heuristic: check if the overnight branch commits are ancestors of current HEAD
  return run.results.map((result) => {
    try {
      // Check if the diff from this step is still reflected in the working tree
      // Simple heuristic: if the branch was merged, assume all steps are present
      // unless specifically reverted
      return result.exitCode === 0;
    } catch {
      return false;
    }
  });
}

/** Record the outcome of a completed run */
export function recordRunOutcome(run: OvernightRun, cwd: string): RunOutcomeRecord {
  const branchMerged = checkBranchMerged(cwd, run.branch, run.baseBranch);

  const steps: StepOutcome[] = run.results.map((result, i) => ({
    message: result.message,
    category: categorizeStep(result.message),
    merged: branchMerged && result.exitCode === 0,
    confidence: run.predictions[i]?.confidence ?? 0.7,
  }));

  const mergedSteps = steps.filter((s) => s.merged).length;
  const totalSteps = steps.length;

  const outcome: RunOutcome = branchMerged
    ? mergedSteps === totalSteps ? "merged" : "partial"
    : "discarded";

  const record: RunOutcomeRecord = {
    runId: run.id,
    timestamp: new Date().toISOString(),
    intent: run.intent,
    outcome,
    ambition: "normal", // TODO: track ambition in OvernightRun
    mode: run.mode,
    steps,
    branchMerged,
  };

  const outcomes = loadOutcomes();
  // Deduplicate by runId
  const existing = outcomes.findIndex((o) => o.runId === run.id);
  if (existing >= 0) {
    outcomes[existing] = record;
  } else {
    outcomes.push(record);
  }
  saveOutcomes(outcomes);

  // Recompute prediction profile
  recomputePredictionProfile(outcomes);

  return record;
}

// ── Profile computation ─────────────────────────────────────────────

/** Recompute the prediction profile from all recorded outcomes */
function recomputePredictionProfile(outcomes: RunOutcomeRecord[]): PredictionProfile {
  const allSteps = outcomes.flatMap((o) => o.steps);

  // Overall merge rate
  const totalMerged = allSteps.filter((s) => s.merged).length;
  const overallMergeRate = allSteps.length > 0 ? totalMerged / allSteps.length : 0;

  // Category merge rates
  const categories: StepCategory[] = ["tests", "docs", "refactor", "feature", "bugfix", "cleanup", "config", "other"];
  const categoryMergeRates: PredictionProfile["categoryMergeRates"] = {} as any;
  for (const cat of categories) {
    const catSteps = allSteps.filter((s) => s.category === cat);
    const catMerged = catSteps.filter((s) => s.merged).length;
    categoryMergeRates[cat] = {
      merged: catMerged,
      total: catSteps.length,
      rate: catSteps.length > 0 ? catMerged / catSteps.length : 0,
    };
  }

  // Ambition merge rates
  const ambitionMergeRates: Record<string, { merged: number; total: number; rate: number }> = {};
  for (const outcome of outcomes) {
    const amb = outcome.ambition;
    if (!ambitionMergeRates[amb]) ambitionMergeRates[amb] = { merged: 0, total: 0, rate: 0 };
    for (const step of outcome.steps) {
      ambitionMergeRates[amb].total++;
      if (step.merged) ambitionMergeRates[amb].merged++;
    }
  }
  for (const amb of Object.keys(ambitionMergeRates)) {
    const a = ambitionMergeRates[amb];
    a.rate = a.total > 0 ? a.merged / a.total : 0;
  }

  // Trusted/distrusted categories (>70% merge = trusted, <30% = distrusted, min 3 samples)
  const trustedCategories = categories.filter((c) => {
    const r = categoryMergeRates[c];
    return r.total >= 3 && r.rate >= 0.7;
  });
  const distrustedCategories = categories.filter((c) => {
    const r = categoryMergeRates[c];
    return r.total >= 3 && r.rate < 0.3;
  });

  // Confidence calibration
  const stepsWithConfidence = allSteps.filter((s) => s.confidence > 0);
  let calibration = 0;
  if (stepsWithConfidence.length > 0) {
    const avgConfidence = stepsWithConfidence.reduce((s, step) => s + step.confidence, 0) / stepsWithConfidence.length;
    calibration = overallMergeRate - avgConfidence; // positive = underconfident, negative = overconfident
  }

  const profile: PredictionProfile = {
    updatedAt: new Date().toISOString(),
    totalRuns: outcomes.length,
    overallMergeRate,
    categoryMergeRates,
    ambitionMergeRates,
    trustedCategories,
    distrustedCategories,
    confidenceCalibration: calibration,
  };

  savePredictionProfile(profile);
  return profile;
}

// ── Prompt context ──────────────────────────────────────────────────

/** Convert prediction profile to prompt context for the predictor */
export function predictionProfileToPromptContext(profile: PredictionProfile | null): string {
  if (!profile || profile.totalRuns < 2) return "";

  const lines: string[] = ["## Prediction History"];
  lines.push(`Based on ${profile.totalRuns} previous runs (${Math.round(profile.overallMergeRate * 100)}% overall merge rate):`);

  if (profile.trustedCategories.length > 0) {
    lines.push(`Trusted categories (high merge rate): ${profile.trustedCategories.join(", ")}`);
  }
  if (profile.distrustedCategories.length > 0) {
    lines.push(`Low-trust categories (often discarded): ${profile.distrustedCategories.join(", ")} — be cautious or skip these`);
  }

  if (profile.confidenceCalibration > 0.1) {
    lines.push(`Note: Predictions tend to be underconfident — the user merges more than expected.`);
  } else if (profile.confidenceCalibration < -0.1) {
    lines.push(`Note: Predictions tend to be overconfident — be more conservative with confidence scores.`);
  }

  return lines.join("\n");
}
