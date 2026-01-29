import { appendFileSync } from "fs";
import { resolve, relative, isAbsolute } from "path";
import { type SecurityConfig, DEFAULT_DENY_PATTERNS } from "./types.js";

// Simple glob pattern matching (supports * and **)
function matchesPattern(filePath: string, pattern: string): boolean {
  // Normalize path
  const normalizedPath = filePath.replace(/\\/g, "/");

  // Convert glob to regex
  let regex = pattern
    .replace(/\./g, "\\.")           // Escape dots
    .replace(/\*\*/g, "{{GLOBSTAR}}")  // Placeholder for **
    .replace(/\*/g, "[^/]*")         // * matches anything except /
    .replace(/{{GLOBSTAR}}/g, ".*"); // ** matches anything including /

  // Match anywhere in path if pattern doesn't start with /
  if (!pattern.startsWith("/")) {
    regex = `(^|/)${regex}`;
  }

  return new RegExp(regex + "$").test(normalizedPath);
}

function isPathWithinSandbox(filePath: string, sandboxDir: string): boolean {
  const absolutePath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
  const absoluteSandbox = isAbsolute(sandboxDir) ? sandboxDir : resolve(process.cwd(), sandboxDir);

  const relativePath = relative(absoluteSandbox, absolutePath);

  // If relative path starts with .. or is absolute, it's outside sandbox
  return !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function isPathDenied(filePath: string, denyPatterns: string[]): string | null {
  for (const pattern of denyPatterns) {
    if (matchesPattern(filePath, pattern)) {
      return pattern;
    }
  }
  return null;
}

export function createSecurityHooks(config: SecurityConfig) {
  const sandboxDir = config.sandbox_dir;
  const denyPatterns = config.deny_patterns ?? DEFAULT_DENY_PATTERNS;
  const auditLog = config.audit_log;

  // PreToolUse hook for path validation
  const preToolUseHook = async (
    input: Record<string, unknown>,
    _toolUseId: string | null,
    _context: { signal?: AbortSignal }
  ) => {
    const hookEventName = input.hook_event_name as string;
    if (hookEventName !== "PreToolUse") return {};

    const toolName = input.tool_name as string;
    const toolInput = input.tool_input as Record<string, unknown>;

    // Extract file path based on tool
    let filePath: string | undefined;
    if (toolName === "Read" || toolName === "Write" || toolName === "Edit") {
      filePath = toolInput.file_path as string;
    } else if (toolName === "Glob" || toolName === "Grep") {
      filePath = toolInput.path as string;
    } else if (toolName === "Bash") {
      // For Bash, we can't easily validate paths, but we can log
      const command = toolInput.command as string;
      if (auditLog) {
        const timestamp = new Date().toISOString();
        appendFileSync(auditLog, `${timestamp} [BASH] ${command}\n`);
      }
      return {};
    }

    if (!filePath) return {};

    // Check sandbox
    if (sandboxDir && !isPathWithinSandbox(filePath, sandboxDir)) {
      return {
        hookSpecificOutput: {
          hookEventName,
          permissionDecision: "deny",
          permissionDecisionReason: `Path "${filePath}" is outside sandbox directory "${sandboxDir}"`,
        },
      };
    }

    // Check deny patterns
    const matchedPattern = isPathDenied(filePath, denyPatterns);
    if (matchedPattern) {
      return {
        hookSpecificOutput: {
          hookEventName,
          permissionDecision: "deny",
          permissionDecisionReason: `Path "${filePath}" matches deny pattern "${matchedPattern}"`,
        },
      };
    }

    return {};
  };

  // PostToolUse hook for audit logging
  const postToolUseHook = async (
    input: Record<string, unknown>,
    _toolUseId: string | null,
    _context: { signal?: AbortSignal }
  ) => {
    if (!auditLog) return {};

    const hookEventName = input.hook_event_name as string;
    if (hookEventName !== "PostToolUse") return {};

    const toolName = input.tool_name as string;
    const toolInput = input.tool_input as Record<string, unknown>;
    const timestamp = new Date().toISOString();

    let logEntry = `${timestamp} [${toolName}]`;

    if (toolName === "Read" || toolName === "Write" || toolName === "Edit") {
      logEntry += ` ${toolInput.file_path}`;
    } else if (toolName === "Glob") {
      logEntry += ` pattern=${toolInput.pattern} path=${toolInput.path ?? "."}`;
    } else if (toolName === "Grep") {
      logEntry += ` pattern=${toolInput.pattern}`;
    }

    appendFileSync(auditLog, logEntry + "\n");
    return {};
  };

  return {
    PreToolUse: [
      { matcher: "Read|Write|Edit|Glob|Grep|Bash", hooks: [preToolUseHook] },
    ],
    PostToolUse: [
      { matcher: "Read|Write|Edit|Glob|Grep|Bash", hooks: [postToolUseHook] },
    ],
  };
}

export function validateSecurityConfig(config: SecurityConfig): void {
  if (config.sandbox_dir) {
    const resolved = isAbsolute(config.sandbox_dir)
      ? config.sandbox_dir
      : resolve(process.cwd(), config.sandbox_dir);
    console.log(`  Sandbox: ${resolved}`);
  }

  const denyPatterns = config.deny_patterns ?? DEFAULT_DENY_PATTERNS;
  console.log(`  Deny patterns: ${denyPatterns.length} patterns`);

  if (config.max_turns) {
    console.log(`  Max turns: ${config.max_turns}`);
  }

  if (config.audit_log) {
    console.log(`  Audit log: ${config.audit_log}`);
  }
}
