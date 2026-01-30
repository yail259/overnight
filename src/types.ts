export interface SecurityConfig {
  sandbox_dir?: string;        // All paths must be under this directory
  deny_patterns?: string[];    // Block files matching these glob patterns
  max_turns?: number;          // Max agent iterations (prevents runaway)
  audit_log?: string;          // Path to audit log file
}

export interface JobConfig {
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

export const DEFAULT_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep"];
export const DEFAULT_TIMEOUT = 300;
export const DEFAULT_STALL_TIMEOUT = 120;
export const DEFAULT_RETRY_COUNT = 3;
export const DEFAULT_RETRY_DELAY = 5;
export const DEFAULT_VERIFY_PROMPT = "Review what you just implemented. Check for correctness, completeness, and compile errors. Fix any issues you find.";
export const DEFAULT_STATE_FILE = ".overnight-state.json";
export const DEFAULT_NTFY_TOPIC = "overnight";
export const DEFAULT_MAX_TURNS = 100;
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
