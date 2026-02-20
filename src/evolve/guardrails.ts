import type { HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import { resolve, relative } from "path";
import type { EvolveConfig } from "../types.js";

function deny(reason: string) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse" as const,
      permissionDecision: "deny" as const,
      permissionDecisionReason: reason,
    },
  };
}

function isWithinDir(filePath: string, dir: string): boolean {
  const resolved = resolve(filePath);
  const rel = relative(dir, resolved);
  return !rel.startsWith("..") && !resolve(rel).startsWith("/");
}

function matchesProtected(filePath: string, config: EvolveConfig): boolean {
  const resolved = resolve(filePath);

  // Hardcoded: never allow modifying the guardrails file itself
  if (resolved.includes("evolve/guardrails")) return true;

  // Config-level protected files
  for (const pf of config.protected_files ?? []) {
    if (resolved.endsWith(pf) || resolved.includes(pf)) return true;
  }

  // Config-level protected patterns (simple glob: ** = any path, * = any name)
  for (const pattern of config.protected_patterns ?? []) {
    const regex = new RegExp(
      "^" + pattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$"
    );
    if (regex.test(filePath) || regex.test(resolved)) return true;
  }

  return false;
}

function extractFilePath(input: unknown): string | undefined {
  const inp = input as { tool_input?: Record<string, unknown> };
  return (
    (inp.tool_input?.file_path as string) ??
    (inp.tool_input?.path as string) ??
    (inp.tool_input?.pattern as string) ??
    undefined
  );
}

export function createEvolveGuardrailHooks(
  config: EvolveConfig,
): { PreToolUse: HookCallbackMatcher[] } {
  const projectDir = resolve(config.project_dir);

  return {
    PreToolUse: [
      // 1. SANDBOX: all file operations must be within project_dir
      {
        matcher: "Read|Write|Edit|Glob|Grep",
        hooks: [
          async (input) => {
            const filePath = extractFilePath(input);
            if (filePath && !isWithinDir(filePath, projectDir)) {
              return deny(`Path outside project directory: ${filePath}`);
            }
            return {};
          },
        ],
      },

      // 2. PROTECTED FILES: never modify certain files
      {
        matcher: "Write|Edit",
        hooks: [
          async (input) => {
            const filePath = extractFilePath(input);
            if (filePath && matchesProtected(filePath, config)) {
              return deny(`Protected file: ${filePath}`);
            }
            return {};
          },
        ],
      },

      // 3. BASH GUARDRAILS: block dangerous commands
      {
        matcher: "Bash",
        hooks: [
          async (input) => {
            const command = (input as any).tool_input?.command as string;
            if (!command) return {};

            // Block force push
            if (/git\s+push\s+.*--force|git\s+push\s+-f\b/i.test(command)) {
              return deny("Force push is not allowed");
            }

            // Block push to main/master
            if (/git\s+push\s+.*\b(main|master)\b/i.test(command)) {
              return deny("Cannot push directly to main/master");
            }

            // Block destructive git operations
            if (/git\s+(reset\s+--hard|clean\s+-f|checkout\s+\.\s|restore\s+\.)/i.test(command)) {
              return deny("Destructive git operations are not allowed");
            }

            // Block git config modifications
            if (/git\s+config/i.test(command)) {
              return deny("Cannot modify git config");
            }

            // Block rm -rf on critical directories
            if (/rm\s+(-rf?|--recursive).*\/(src|lib|\.git)\b/i.test(command)) {
              return deny("Cannot recursively delete critical directories");
            }

            return {};
          },
        ],
      },
    ],
  };
}
