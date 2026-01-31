export interface SecurityConfig {
  sandbox_dir?: string;        // All paths must be under this directory
  deny_patterns?: string[];    // Block files matching these glob patterns
  max_turns?: number;          // Max agent iterations (prevents runaway)
  audit_log?: string;          // Path to audit log file
}

export interface JobConfig {
  id?: string;                // Stable task identifier for dependency references
  depends_on?: string[];      // IDs of tasks that must complete before this one
  prompt: string;
  working_dir?: string;
  timeout_seconds?: number;
  stall_timeout_seconds?: number;
  verify?: boolean;
  verify_prompt?: string;
  allowed_tools?: string[];
  retry_count?: number;
  retry_delay?: number;
  security?: SecurityConfig;
}

export interface JobResult {
  task: string;
  status: "success" | "failed" | "timeout" | "stalled" | "verification_failed";
  result?: string;
  error?: string;
  duration_seconds: number;
  verified: boolean;
  retries: number;
}

export interface InProgressTask {
  hash: string;
  prompt: string;
  sessionId?: string;  // SDK session ID for resumption
  startedAt: string;
}

export interface RunState {
  completed: Record<string, JobResult>; // keyed by task hash
  inProgress?: InProgressTask;          // currently running task
  timestamp: string;
}

export interface TasksFile {
  defaults?: {
    timeout_seconds?: number;
    stall_timeout_seconds?: number;
    verify?: boolean;
    verify_prompt?: string;
    allowed_tools?: string[];
    security?: SecurityConfig;
  };
  tasks: (string | JobConfig)[];
}

// --- Goal mode types ---

export interface GoalConfig {
  goal: string;                      // High-level objective
  acceptance_criteria?: string[];    // What must be true for the goal to be met
  verification_commands?: string[];  // Commands that must exit 0 (e.g. "npm test", "npm run build")
  constraints?: string[];            // Things the agent should NOT do
  max_iterations?: number;           // Hard cap on build loop iterations
  convergence_threshold?: number;    // Stalled iterations before stopping (default: 3)
  defaults?: TasksFile["defaults"];  // Same defaults as tasks.yaml
}

export interface IterationState {
  iteration: number;
  completed_items: string[];
  remaining_items: string[];
  known_issues: string[];
  files_modified: string[];
  agent_done: boolean;               // Did the agent self-report "done"?
  timestamp: string;
}

export interface GateCheck {
  name: string;
  passed: boolean;
  output: string;
}

export interface GateResult {
  passed: boolean;
  checks: GateCheck[];
  summary: string;
  failures: string[];
}

export interface GoalRunState {
  goal: string;
  iterations: IterationState[];
  gate_results: GateResult[];
  status: "running" | "gate_passed" | "gate_failed" | "stalled" | "max_iterations";
  timestamp: string;
}

// --- Constants ---

export const DEFAULT_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep"];
export const DEFAULT_TIMEOUT = 300;
export const DEFAULT_STALL_TIMEOUT = 120;
export const DEFAULT_RETRY_COUNT = 3;
export const DEFAULT_RETRY_DELAY = 5;
export const DEFAULT_VERIFY_PROMPT = "Review what you just implemented. Check for correctness, completeness, and compile errors. Fix any issues you find.";
export const DEFAULT_STATE_FILE = ".overnight-state.json";
export const DEFAULT_GOAL_STATE_FILE = ".overnight-goal-state.json";
export const DEFAULT_NTFY_TOPIC = "overnight";
export const DEFAULT_MAX_TURNS = 100;
export const DEFAULT_MAX_ITERATIONS = 20;
export const DEFAULT_CONVERGENCE_THRESHOLD = 3;
export const DEFAULT_DENY_PATTERNS = [
  "**/.env",
  "**/.env.*",
  "**/.git/config",
  "**/credentials*",
  "**/*.key",
  "**/*.pem",
  "**/*.p12",
  "**/id_rsa*",
  "**/id_ed25519*",
  "**/.ssh/*",
  "**/.aws/*",
  "**/.npmrc",
  "**/.netrc",
];
