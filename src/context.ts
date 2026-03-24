/**
 * WorkspaceContext — the predictor's memory system.
 *
 * Generates a rich workspace dump at run start, gives the predictor
 * tools to read/forget file content on demand, and manages what's
 * currently loaded in context.
 *
 * The predictor sees the workspace dump (surface-level: file tree, git
 * log, README, ROADMAP, dependencies) and uses `read` to drill into
 * specific files. `forget` drops loaded content to keep context lean.
 *
 * Each run saves the workspace dump to .overnight/runs/{run-id}/workspace.txt
 * for debugging ("why did it suggest X?").
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { RUNS_DIR } from "./types.js";

// ── Shell helper ────────────────────────────────────────────────────

function run(cmd: string, cwd: string, timeout = 5_000): string {
  try {
    return execSync(cmd, { cwd, stdio: "pipe", timeout }).toString().trim();
  } catch {
    return "";
  }
}

// ── Workspace dump ──────────────────────────────────────────────────

/** Generate a comprehensive workspace dump — everything surface-level.
 *  The model uses this to decide what to read deeper. */
export function generateWorkspaceDump(cwd: string): string {
  const sections: string[] = [];

  // Git state
  const branch = run("git rev-parse --abbrev-ref HEAD", cwd);
  if (branch) sections.push(`Branch: ${branch}`);

  // Recent commits with stats — what's been DONE recently
  const commits = run("git log -10 --pretty=format:'%h %s' --stat 2>/dev/null", cwd);
  if (commits) sections.push(`## Recent Commits\n${commits}`);

  // Uncommitted changes — what's in progress
  const status = run("git status --short", cwd);
  if (status) sections.push(`## Working Tree\n${status}`);

  const uncommitted = run("git diff --stat 2>/dev/null", cwd);
  if (uncommitted) sections.push(`## Uncommitted Changes\n${uncommitted}`);

  // File tree — what EXISTS
  const srcFiles = run(
    "find src -type f \\( -name '*.ts' -o -name '*.tsx' \\) 2>/dev/null | sort",
    cwd,
  );
  if (srcFiles) sections.push(`## Source Files\n${srcFiles}`);

  const testFiles = run(
    "find . -type f \\( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' \\) 2>/dev/null | sort",
    cwd,
  );
  if (testFiles) sections.push(`## Test Files\n${testFiles}`);

  // Export signatures — what each module PROVIDES (quick scan without reading full files)
  if (srcFiles) {
    const files = srcFiles.split("\n").filter(Boolean);
    const sigSections: string[] = [];
    for (const file of files) {
      const sigs = run(
        `grep -n '^export ' "${file}" 2>/dev/null | head -20`,
        cwd,
      );
      if (sigs) sigSections.push(`### ${file}\n${sigs}`);
    }
    if (sigSections.length > 0) {
      sections.push(`## Module Exports\n${sigSections.join("\n")}`);
    }
  }

  // Package.json — dependencies and scripts
  const pkg = run(
    `node -e "try{const p=require('./package.json');console.log('Name: '+p.name);console.log('Version: '+p.version);console.log('Scripts: '+Object.keys(p.scripts||{}).join(', '));console.log('Dependencies: '+Object.keys(p.dependencies||{}).join(', '));console.log('DevDependencies: '+Object.keys(p.devDependencies||{}).join(', '))}catch{}" 2>/dev/null`,
    cwd,
  );
  if (pkg) sections.push(`## Package\n${pkg}`);

  // README
  const readme = run("cat README.md 2>/dev/null", cwd);
  if (readme) sections.push(`## README.md\n${readme}`);

  // ROADMAP if it exists
  const roadmap = run("cat ROADMAP.md 2>/dev/null", cwd);
  if (roadmap) sections.push(`## ROADMAP.md\n${roadmap}`);

  // CLAUDE.md if it exists
  const claudeMd = run("cat CLAUDE.md 2>/dev/null", cwd);
  if (claudeMd) sections.push(`## CLAUDE.md\n${claudeMd}`);

  return sections.join("\n\n");
}

/** Save workspace dump for a specific run */
export function saveWorkspaceDump(runId: string, dump: string): void {
  const runDir = join(RUNS_DIR, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "workspace.txt"), dump);
}

// ── Context manager ─────────────────────────────────────────────────

/** Manages loaded file content in the predictor's working memory */
export class ContextManager {
  private cwd: string;
  private loaded: Map<string, string> = new Map();

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  /** Read a file or chunk. Returns content or error message. */
  read(path: string, offset?: number, limit?: number): string {
    try {
      const fullPath = join(this.cwd, path);
      if (!existsSync(fullPath)) {
        return `Error: ${path} not found`;
      }

      const content = readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");

      const start = offset ? Math.max(0, offset - 1) : 0; // 1-indexed to 0-indexed
      const end = limit ? Math.min(lines.length, start + limit) : lines.length;
      const slice = lines.slice(start, end);

      // Numbered lines for reference
      const numbered = slice.map((line, i) => `${start + i + 1}\t${line}`).join("\n");
      const header = `${path} (lines ${start + 1}-${end} of ${lines.length})`;
      const result = `${header}\n${numbered}`;

      // Store in loaded context
      this.loaded.set(path, result);
      return result;
    } catch (err: any) {
      return `Error reading ${path}: ${err.message}`;
    }
  }

  /** Forget a loaded file — remove from working memory */
  forget(path: string): string {
    if (path === "all") {
      const count = this.loaded.size;
      this.loaded.clear();
      return `Forgot ${count} loaded files`;
    }
    if (this.loaded.has(path)) {
      this.loaded.delete(path);
      return `Forgot ${path}`;
    }
    return `${path} not in context`;
  }

  /** Get all currently loaded content (for debugging) */
  getLoadedFiles(): string[] {
    return Array.from(this.loaded.keys());
  }

  /** Get total loaded content size */
  getLoadedSize(): number {
    let size = 0;
    for (const content of this.loaded.values()) size += content.length;
    return size;
  }
}
