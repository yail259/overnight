/** Ambition level for plan suggestions */
export type AmbitionLevel = "safe" | "normal" | "yolo";

export const AMBITION_LEVELS: AmbitionLevel[] = ["safe", "normal", "yolo"];

/** Run mode — stick to plan (one sprint) or don't stop (continuous) */
export type RunMode = "stick-to-plan" | "dont-stop";

/** User's current working direction — trajectory, not tasks */
export interface UserDirection {
  /** When this direction was extracted */
  extractedAt: string;
  /** The cwd this direction applies to */
  cwd: string;
  /** High-level area of focus — e.g. "auth system", "TUI polish" (NOT a task) */
  area: string;
  /** Kind of work — "building-new" | "refactoring" | "debugging" | "polishing" | "exploring" */
  workType: string;
  /** Architectural patterns/themes being pursued */
  themes: string[];
  /** Frustrations or improvement signals — NOT tasks */
  tensions: string[];
  /** What's gaining energy vs winding down */
  momentum: string;
  /** Files recently changed (from git, not conversation) */
  recentlyTouched: string[];
}

/** A single user-typed message extracted from a Claude Code session */
export interface UserMessage {
  text: string;
  timestamp: string;
  cwd: string;
  gitBranch: string;
  sessionId: string;
  project: string; // derived from cwd
}

/** A discovered project with activity metadata */
export interface ProjectInfo {
  name: string;
  cwd: string;
  lastActive: Date;
  sessionCount: number;
  messageCount: number;
}

/** A predicted message to send to Claude Code */
export interface PredictedMessage {
  message: string;
  reasoning: string;
  confidence: number; // 0-1
}

/** A suggested overnight plan (from auto mode) */
export interface SuggestedPlan {
  intent: string;
  description: string;
  project: string; // which project/cwd this applies to
  cwd: string;
  estimatedMessages: number;
}

/** Result of executing a single predicted message */
export interface ExecutionResult {
  message: string;
  branch: string;
  exitCode: number;
  output: string; // last 5KB of stream-json output
  diff: string; // git diff --stat after execution
  testsPass: boolean;
  buildPass: boolean;
  costUsd: number;
  durationSeconds: number;
  timestamp: string;
}

/** Context fed back to the predictor for adaptive prediction */
export interface AdaptiveContext {
  /** Steps completed so far in this run */
  completedSteps: {
    message: string;
    output: string;
    diff: string;
    exitCode: number;
    testsPass: boolean;
    buildPass: boolean;
  }[];
  /** Run mode */
  mode: RunMode;
  /** Ambition level */
  ambition: AmbitionLevel;
  /** High-level goals from the preview/plan */
  goals?: string[];
  /** User's current direction — extracted once at run start */
  direction?: UserDirection;
}

/** A complete overnight run */
export interface OvernightRun {
  id: string;
  intent: string;
  startedAt: string;
  finishedAt?: string;
  cwd: string;
  baseBranch: string;
  branch: string; // overnight/{run-id} — single branch for all messages
  mode: RunMode;
  predictions: PredictedMessage[]; // grows as adaptive loop adds predictions
  results: ExecutionResult[];
  status: "running" | "completed" | "stopped" | "failed";
}

/** API provider — "anthropic" (default) or "openai" for OpenAI-compatible endpoints */
export type ApiProvider = "anthropic" | "openai";

/** Config stored in ~/.overnight/config.json */
export interface OvernightConfig {
  claudeBin: string; // path to claude CLI
  maxMessages: number; // max predicted messages per run (safety cap)
  model: string; // model for prediction
  apiKey: string; // API key (or set ANTHROPIC_API_KEY / OPENAI_API_KEY env)
  baseUrl: string; // custom base URL (e.g. for proxy or gateway)
  apiProvider: ApiProvider; // "anthropic" or "openai" (default: "anthropic")
}

export const DEFAULT_CONFIG: OvernightConfig = {
  claudeBin: "claude",
  maxMessages: 20, // higher cap since adaptive loop self-terminates
  model: "claude-sonnet-4-6",
  apiKey: "",
  baseUrl: "",
  apiProvider: "anthropic",
};

/** Live run state for the TUI status bar */
export interface RunState {
  status: "starting" | "running" | "completed" | "failed" | "stopped";
  runId: string;
  total: number; // grows dynamically with adaptive prediction
  current: number; // 0-indexed, which message is executing now
  currentMessage?: string; // preview of current message
  passed: number;
  failed: number;
  elapsed: number; // seconds
  startedAt: number; // Date.now() when run started
  mode: RunMode;
}

/** Pending approval prompt after preview_run */
export interface PendingApproval {
  intent: string;
  cwd: string;
  goals: string[];
}

export const OVERNIGHT_DIR = `${process.env.HOME}/.overnight`;
export const RUNS_DIR = `${OVERNIGHT_DIR}/runs`;
export const CONFIG_FILE = `${OVERNIGHT_DIR}/config.json`;
export const PID_FILE = `${OVERNIGHT_DIR}/overnight.pid`;
