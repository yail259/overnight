/**
 * Extract messages from Claude Code session files.
 * Scrapes both user input AND assistant responses for richer signal.
 * Claude Code stores conversations in ~/.claude/projects/<project-key>/<session-id>.jsonl
 *
 * Token-budgeted: reads all sessions, prioritizes recent, trims oldest at ~100k tokens.
 */

import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { join, basename } from "path";
import { encodingForModel } from "js-tiktoken";
import type { UserMessage, ProjectInfo } from "./types.js";

const CLAUDE_DIR = join(process.env.HOME!, ".claude", "projects");
const TOKEN_BUDGET = 100_000;

// Lazy-init encoder (cl100k_base — close enough for any model)
let _enc: ReturnType<typeof encodingForModel> | null = null;
function enc() {
  if (!_enc) _enc = encodingForModel("gpt-4o");
  return _enc;
}
function countTokens(text: string): number {
  return enc().encode(text).length;
}

/** A full conversation turn: what the user said + what Claude replied */
export interface ConversationTurn {
  user: UserMessage;
  assistantReply: string;
}

interface SessionEntry {
  type: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string; thinking?: string }>;
  };
  cwd?: string;
  gitBranch?: string;
  sessionId?: string;
  timestamp?: string;
}

/** Derive project name from cwd (last path segment) */
function projectFromCwd(cwd: string): string {
  return basename(cwd);
}

/** Extract text from a message content field */
function extractText(
  content: string | Array<{ type: string; text?: string }> | undefined
): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textBlocks = content.filter(
      (b) => b.type === "text" && b.text && !b.text.startsWith('{"tool_use_id"')
    );
    if (textBlocks.length > 0) return textBlocks.map((b) => b.text!).join("\n");
  }
  return null;
}

/** Extract assistant text reply (skip thinking blocks and tool_use) */
function extractAssistantText(
  content: string | Array<{ type: string; text?: string; thinking?: string }> | undefined
): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textBlocks = content.filter((b) => b.type === "text" && b.text);
    if (textBlocks.length > 0)
      return textBlocks.map((b) => (b as any).text!).join("\n");
  }
  return null;
}

/** Check if a message is a genuine user-typed message */
function isUserTyped(entry: SessionEntry): boolean {
  if (entry.type !== "user") return false;
  if (!entry.message?.content) return false;

  const content = entry.message.content;

  if (typeof content === "object" && !Array.isArray(content)) return false;
  if (typeof content === "string" && content.startsWith('{"tool_use_id"'))
    return false;

  if (Array.isArray(content)) {
    if (content.length === 0) return false;
    const first = content[0];
    if (typeof first === "object" && "tool_use_id" in first) return false;
    const hasText = content.some(
      (b) => b.type === "text" && b.text && b.text.trim().length > 0
    );
    if (!hasText) return false;
  }

  const text = extractText(content);
  if (!text) return false;
  if (text.trim().length < 3) return false;

  return true;
}

/** Parse a session file into ordered entries */
function parseSessionEntries(filePath: string): SessionEntry[] {
  const entries: SessionEntry[] = [];
  try {
    const lines = readFileSync(filePath, "utf-8").trim().split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        // skip malformed
      }
    }
  } catch {
    // skip unreadable
  }
  return entries;
}

/** Read conversation turns (user + assistant pairs) from a session file.
 *  Skips non-interactive sessions (single-message `claude -p` invocations). */
export function readConversationTurns(filePath: string): ConversationTurn[] {
  const entries = parseSessionEntries(filePath);

  // Count genuine user messages to detect non-interactive sessions.
  // `claude -p` sessions have exactly 1 user message (often a long system prompt).
  // Skip these — they're automated invocations, not interactive conversations.
  let userTypedCount = 0;
  let firstUserLen = 0;
  for (const e of entries) {
    if (isUserTyped(e)) {
      userTypedCount++;
      if (userTypedCount === 1) {
        const text = extractText(e.message!.content);
        firstUserLen = text?.length ?? 0;
      }
      if (userTypedCount > 1) break; // no need to count further
    }
  }
  // Single-message session with a long prompt → automated, skip it
  if (userTypedCount <= 1 && firstUserLen > 500) return [];

  const turns: ConversationTurn[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!isUserTyped(entry)) continue;

    const text = extractText(entry.message!.content);
    if (!text) continue;

    // Truncate long user messages — real user input is short.
    // Long messages are typically pasted output, error logs, or tool output.
    const trimmedText = text.trim().length > 300
      ? text.trim().slice(0, 200) + " [truncated — pasted content]"
      : text.trim();

    const userMsg: UserMessage = {
      text: trimmedText,
      timestamp: entry.timestamp ?? "",
      cwd: entry.cwd ?? "",
      gitBranch: entry.gitBranch ?? "",
      sessionId: entry.sessionId ?? basename(filePath, ".jsonl"),
      project: entry.cwd ? projectFromCwd(entry.cwd) : "unknown",
    };

    // Look ahead for the LAST assistant text reply before the next user message.
    // Claude often says "Let me read that" (short) then does tool calls then
    // says "Done, here's the diff" (long). We want the final comprehensive reply.
    // Tool results are stored as type:"user" with tool_result content —
    // skip those, only stop at a genuine user-typed message.
    let assistantReply = "";
    for (let j = i + 1; j < entries.length; j++) {
      const next = entries[j];
      // Stop at next genuine user message (not a tool_result)
      if (next.type === "user" && isUserTyped(next)) break;
      if (next.type === "assistant" && next.message?.content) {
        const reply = extractAssistantText(next.message.content);
        if (reply && reply.trim().length > 0) {
          assistantReply = reply.trim(); // keep overwriting — last one wins
        }
      }
    }

    turns.push({ user: userMsg, assistantReply });
  }

  return turns;
}

/** Read all user messages from a single session file */
function readSessionFile(filePath: string): UserMessage[] {
  return readConversationTurns(filePath).map((t) => t.user);
}

/** Get all project directories in ~/.claude/projects/ */
function getProjectDirs(): string[] {
  if (!existsSync(CLAUDE_DIR)) return [];
  return readdirSync(CLAUDE_DIR)
    .map((d) => join(CLAUDE_DIR, d))
    .filter((d) => {
      try {
        return statSync(d).isDirectory();
      } catch {
        return false;
      }
    });
}

/** Get ALL session files for a project dir, sorted by recency (no limit) */
function getSessionFiles(projDir: string): string[] {
  try {
    return readdirSync(projDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(projDir, f))
      .sort((a, b) => {
        try {
          return statSync(b).mtimeMs - statSync(a).mtimeMs;
        } catch {
          return 0;
        }
      });
  } catch {
    return [];
  }
}

// ── Project discovery ──────────────────────────────────────────────

/** Discover all projects with activity metadata, sorted by most recently active */
export function getProjectList(): ProjectInfo[] {
  const projectMap = new Map<string, ProjectInfo>();

  for (const projDir of getProjectDirs()) {
    const sessions = getSessionFiles(projDir);
    if (sessions.length === 0) continue;

    // Sample up to 3 recent sessions to discover project name + cwd
    const sampled = sessions.slice(0, 3);
    for (const file of sampled) {
      const msgs = readSessionFile(file);
      for (const m of msgs) {
        if (!m.project || !m.cwd) continue;
        const key = m.cwd; // unique by cwd
        const existing = projectMap.get(key);
        const ts = m.timestamp ? new Date(m.timestamp) : new Date(0);
        if (!existing) {
          projectMap.set(key, {
            name: m.project,
            cwd: m.cwd,
            lastActive: ts,
            sessionCount: sessions.length,
            messageCount: 1,
          });
        } else {
          if (ts > existing.lastActive) existing.lastActive = ts;
          existing.messageCount++;
          existing.sessionCount = Math.max(existing.sessionCount, sessions.length);
        }
      }
    }
  }

  return [...projectMap.values()].sort(
    (a, b) => b.lastActive.getTime() - a.lastActive.getTime()
  );
}

// ── Token-budgeted message fetching ────────────────────────────────

interface FetchOptions {
  /** Filter to this cwd (and children). Omit for all projects. */
  cwd?: string;
  /** Filter to these project names. Omit for all. */
  projects?: string[];
  /** Token budget (default 100k) */
  tokenBudget?: number;
}

/** Get all user messages, token-budgeted, most recent first */
export function getAllMessages(opts: FetchOptions = {}): UserMessage[] {
  const budget = opts.tokenBudget ?? TOKEN_BUDGET;
  const all: UserMessage[] = [];

  for (const projDir of getProjectDirs()) {
    for (const file of getSessionFiles(projDir)) {
      all.push(...readSessionFile(file));
    }
  }

  // Sort by recency (most recent first)
  all.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  // Filter by cwd if provided
  let filtered = all;
  if (opts.cwd) {
    filtered = all.filter(
      (m) => m.cwd === opts.cwd || m.cwd.startsWith(opts.cwd + "/")
    );
  }
  if (opts.projects && opts.projects.length > 0) {
    const projSet = new Set(opts.projects);
    filtered = filtered.filter((m) => projSet.has(m.project));
  }

  // Token-budget: keep adding messages until we hit the budget
  const result: UserMessage[] = [];
  let tokens = 0;
  for (const m of filtered) {
    const t = countTokens(m.text);
    if (tokens + t > budget) break;
    tokens += t;
    result.push(m);
  }

  return result;
}

/** Get all conversation turns, token-budgeted, most recent first */
export function getAllConversationTurns(opts: FetchOptions = {}): ConversationTurn[] {
  const budget = opts.tokenBudget ?? TOKEN_BUDGET;
  const all: ConversationTurn[] = [];

  for (const projDir of getProjectDirs()) {
    for (const file of getSessionFiles(projDir)) {
      all.push(...readConversationTurns(file));
    }
  }

  all.sort(
    (a, b) =>
      new Date(b.user.timestamp).getTime() -
      new Date(a.user.timestamp).getTime()
  );

  // Filter
  let filtered = all;
  if (opts.cwd) {
    filtered = all.filter(
      (t) => t.user.cwd === opts.cwd || t.user.cwd.startsWith(opts.cwd + "/")
    );
  }
  if (opts.projects && opts.projects.length > 0) {
    const projSet = new Set(opts.projects);
    filtered = filtered.filter((t) => projSet.has(t.user.project));
  }

  // Token-budget
  const result: ConversationTurn[] = [];
  let tokens = 0;
  for (const t of filtered) {
    const text = t.user.text + (t.assistantReply ? "\n" + t.assistantReply : "");
    const c = countTokens(text);
    if (tokens + c > budget) break;
    tokens += c;
    result.push(t);
  }

  return result;
}

/** Get user messages for a specific working directory */
export function getMessagesForCwd(cwd: string, tokenBudget?: number): UserMessage[] {
  return getAllMessages({ cwd, tokenBudget });
}

// ── Summaries ──────────────────────────────────────────────────────

/** Get a summary of the user's message patterns (for the predictor) */
export function getMessageSummary(messages: UserMessage[]): string {
  if (messages.length === 0) return "No message history available.";

  const lines: string[] = [];
  lines.push(`${messages.length} messages from recent Claude Code sessions:\n`);

  const byProject = new Map<string, UserMessage[]>();
  for (const m of messages) {
    const proj = m.project;
    if (!byProject.has(proj)) byProject.set(proj, []);
    byProject.get(proj)!.push(m);
  }

  for (const [project, msgs] of byProject) {
    lines.push(`## Project: ${project} (${msgs.length} messages)`);
    for (const msg of msgs.slice(0, 30)) {
      const ts = msg.timestamp ? new Date(msg.timestamp).toISOString().slice(0, 16) : "?";
      lines.push(`- [${ts}] "${msg.text}"`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** Get a rich conversation summary including assistant replies */
export function getConversationSummary(turns: ConversationTurn[]): string {
  if (turns.length === 0) return "No conversation history available.";

  const lines: string[] = [];
  lines.push(`${turns.length} conversation turns from recent sessions:\n`);

  const byProject = new Map<string, ConversationTurn[]>();
  for (const t of turns) {
    const proj = t.user.project;
    if (!byProject.has(proj)) byProject.set(proj, []);
    byProject.get(proj)!.push(t);
  }

  for (const [project, projectTurns] of byProject) {
    lines.push(`## Project: ${project} (${projectTurns.length} turns)`);
    for (const t of projectTurns.slice(0, 25)) {
      const ts = t.user.timestamp ? new Date(t.user.timestamp).toISOString().slice(0, 16) : "?";
      lines.push(`> [${ts}] User: "${t.user.text}"`);
      if (t.assistantReply) {
        const reply =
          t.assistantReply.length > 600
            ? "..." + t.assistantReply.slice(-597)
            : t.assistantReply;
        lines.push(`  Claude: "${reply}"`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
