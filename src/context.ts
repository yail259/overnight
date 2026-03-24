/**
 * Context system — the predictor's interface to the workspace.
 *
 * Two tools:
 * - `sh` — run any read-only shell command (sandboxed: no writes, no network)
 * - `forget` — drop a previous tool result from conversation to free context
 *
 * Also generates:
 * - Workspace dump (surface-level: file tree, git log, exports, README, etc.)
 * - Conversation history file (user messages from Claude Code sessions)
 *
 * Context persists across the execution loop by default. The agent only
 * forgets when it actively wants to free space.
 */

import { execSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { RUNS_DIR } from "./types.js";
import { getAllConversationTurns } from "./history.js";

// ── Shell execution ─────────────────────────────────────────────────

/** Blocklist of destructive commands/patterns */
const BLOCKED_PATTERNS = [
  /\brm\s+-/,
  /\brm\b.*\s+\//,
  /\bgit\s+(push|reset|checkout\s+--|clean|stash\s+drop)/,
  /\bgit\s+branch\s+-[dD]/,
  /\bcurl\b/,
  /\bwget\b/,
  /\bnpm\s+(publish|unpublish)/,
  /\bchmod\b/,
  /\bchown\b/,
  /\bmkdir\b/,
  /\btouch\b/,
  /\bmv\b/,
  /\bcp\b.*>/,
  />\s*\//,
  /\|.*tee\b/,
  /\bdd\b/,
  /\bkill\b/,
  /\bsudo\b/,
];

/** Run a sandboxed shell command — read-only, no network, capped output */
export function runSandboxedSh(cmd: string, cwd: string, timeoutMs = 10_000, maxOutput = 20_000): string {
  // Block destructive commands
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) {
      return `Blocked: "${cmd}" — sh tool is read-only. No writes, no network, no destructive operations.`;
    }
  }

  try {
    const result = execSync(cmd, {
      cwd,
      stdio: "pipe",
      timeout: timeoutMs,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    }).toString();

    // Cap output to prevent context blowup
    if (result.length > maxOutput) {
      return result.slice(0, maxOutput) + `\n\n... (output truncated at ${maxOutput} chars, use more specific commands)`;
    }
    return result || "(no output)";
  } catch (err: any) {
    const stderr = err.stderr?.toString()?.slice(0, 500) ?? "";
    const stdout = err.stdout?.toString()?.slice(0, 500) ?? "";
    return `Exit code ${err.status ?? 1}\n${stdout}\n${stderr}`.trim();
  }
}

// ── Workspace dump ──────────────────────────────────────────────────

/** Non-sandboxed shell helper for dump generation */
function run(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, stdio: "pipe", timeout: 5_000 }).toString().trim();
  } catch {
    return "";
  }
}

/** Generate a comprehensive workspace dump.
 *  The model sees this as initial context and uses `sh` to drill deeper. */
export function generateWorkspaceDump(cwd: string): string {
  const sections: string[] = [];

  const branch = run("git rev-parse --abbrev-ref HEAD", cwd);
  if (branch) sections.push(`Branch: ${branch}`);

  const commits = run("git log -10 --pretty=format:'%h %s' --stat 2>/dev/null", cwd);
  if (commits) sections.push(`## Recent Commits\n${commits}`);

  const status = run("git status --short", cwd);
  if (status) sections.push(`## Working Tree\n${status}`);

  const srcFiles = run(
    "find src -type f \\( -name '*.ts' -o -name '*.tsx' \\) 2>/dev/null | sort",
    cwd,
  );
  if (srcFiles) sections.push(`## Source Files\n${srcFiles}`);

  // Export signatures — what each module PROVIDES
  if (srcFiles) {
    const files = srcFiles.split("\n").filter(Boolean);
    const sigs: string[] = [];
    for (const file of files) {
      const exports = run(`grep -n '^export ' "${file}" 2>/dev/null | head -20`, cwd);
      if (exports) sigs.push(`### ${file}\n${exports}`);
    }
    if (sigs.length > 0) sections.push(`## Module Exports\n${sigs.join("\n")}`);
  }

  const testFiles = run(
    "find . -type f \\( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' \\) 2>/dev/null | sort",
    cwd,
  );
  if (testFiles) sections.push(`## Test Files\n${testFiles}`);

  const pkg = run(
    `node -e "try{const p=require('./package.json');console.log('Name: '+p.name);console.log('Version: '+p.version);console.log('Scripts: '+Object.keys(p.scripts||{}).join(', '));console.log('Deps: '+Object.keys(p.dependencies||{}).join(', '))}catch{}" 2>/dev/null`,
    cwd,
  );
  if (pkg) sections.push(`## Package\n${pkg}`);

  const readme = run("cat README.md 2>/dev/null", cwd);
  if (readme) sections.push(`## README.md\n${readme}`);

  const roadmap = run("cat ROADMAP.md 2>/dev/null", cwd);
  if (roadmap) sections.push(`## ROADMAP.md\n${roadmap}`);

  return sections.join("\n\n");
}

// ── Conversation history dump ───────────────────────────────────────

/** Generate a flat dump of user messages from Claude Code sessions.
 *  Pure voice samples — the predictor reads these to match the user's style. */
export function generateHistoryDump(cwd?: string): string {
  const turns = getAllConversationTurns({ cwd, tokenBudget: 50_000 });
  if (turns.length === 0) return "No conversation history available.";

  const lines: string[] = [`## Conversation History (${turns.length} recent turns)\n`];
  for (const turn of turns) {
    lines.push(`> ${turn.userMessage}`);
    if (turn.assistantSummary) {
      lines.push(`  ${turn.assistantSummary.slice(0, 200)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ── Save dump per run ───────────────────────────────────────────────

export function saveWorkspaceDump(runId: string, dump: string): void {
  const runDir = join(RUNS_DIR, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "workspace.txt"), dump);
}
