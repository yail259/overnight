/**
 * Slash command registry for the overnight TUI.
 *
 * Commands have access to dispatch (state mutations), addMessage (display),
 * and addToast (ephemeral feedback). Some commands shell out for git/profile info.
 */

import { execSync } from "child_process";
import type { AppAction, Message, ToastMessage } from "./types.js";
import { loadProfile, profileToPromptContext } from "../profile.js";
import { getLatestRun } from "../executor.js";
import { listSessions } from "./session.js";
import { AMBITION_LEVELS } from "../types.js";
import type { AmbitionLevel } from "../types.js";

export interface CommandExtra {
  addMessage: (msg: Message) => void;
  addToast: (text: string, type?: "info" | "warning" | "success", duration?: number) => void;
  onCompact?: () => Promise<void>;
  onClear?: () => void;
}

export interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  handler: (
    args: string,
    dispatch: (action: AppAction) => void,
    extra: CommandExtra,
  ) => void | Promise<void>;
}

const COMMANDS: SlashCommand[] = [
  // ── Display ─────────────────────────────────────────────────────
  {
    name: "clear",
    description: "Clear conversation history",
    handler: (_args, dispatch, { addToast, onClear }) => {
      dispatch({ type: "CLEAR_MESSAGES" });
      onClear?.();
      addToast("Conversation cleared", "info");
    },
  },
  {
    name: "compact",
    description: "Compress conversation context",
    handler: async (_args, _dispatch, { addMessage, addToast, onCompact }) => {
      if (onCompact) {
        addToast("Compressing context...", "info");
        await onCompact();
        addToast("Context compressed", "success");
      } else {
        addToast("Context compression not available", "warning");
      }
    },
  },
  {
    name: "verbose",
    aliases: ["v"],
    description: "Toggle compact/verbose display",
    handler: (_args, dispatch, { addToast }) => {
      dispatch({ type: "TOGGLE_DISPLAY_MODE" });
      addToast("Display mode toggled", "info");
    },
  },

  // ── Profile & Status ────────────────────────────────────────────
  {
    name: "profile",
    aliases: ["p"],
    description: "Show your overnight profile",
    handler: (_args, _dispatch, { addMessage }) => {
      const profile = loadProfile();
      if (!profile.updatedAt) {
        addMessage({ id: `prof-${Date.now()}`, type: "system", text: "No profile yet. Run overnight to build one from your Claude Code history.", timestamp: Date.now() });
        return;
      }
      const lines: string[] = [];
      if (profile.communicationStyle.tone) {
        lines.push(`Communication: ${profile.communicationStyle.tone}, ${profile.communicationStyle.messageLength}`);
        if (profile.communicationStyle.patterns.length > 0)
          lines.push(`Patterns: ${profile.communicationStyle.patterns.join(", ")}`);
      }
      if (profile.codingPatterns.languages.length > 0)
        lines.push(`Languages: ${profile.codingPatterns.languages.join(", ")}`);
      if (profile.codingPatterns.frameworks.length > 0)
        lines.push(`Frameworks: ${profile.codingPatterns.frameworks.join(", ")}`);
      if (profile.codingPatterns.preferences.length > 0)
        lines.push(`Preferences: ${profile.codingPatterns.preferences.join(", ")}`);
      if (profile.codingPatterns.avoids.length > 0)
        lines.push(`Avoids: ${profile.codingPatterns.avoids.join(", ")}`);
      if (profile.values.length > 0)
        lines.push(`Values: ${profile.values.join(", ")}`);
      lines.push(`\nUpdated: ${new Date(profile.updatedAt).toLocaleString()} (${profile.turnsAnalyzed} turns)`);
      addMessage({ id: `prof-${Date.now()}`, type: "system", text: lines.join("\n"), timestamp: Date.now() });
    },
  },
  {
    name: "ambition",
    aliases: ["a"],
    description: "Set ambition: safe, normal, yolo",
    handler: (args, dispatch, { addToast }) => {
      const level = args.trim().toLowerCase();
      if (AMBITION_LEVELS.includes(level as AmbitionLevel)) {
        dispatch({ type: "SET_AMBITION", ambition: level as AmbitionLevel });
        addToast(`Ambition: ${level}`, level === "yolo" ? "warning" : "success", 2000);
      } else {
        addToast(`Usage: /ambition <safe|normal|yolo>`, "warning");
      }
    },
  },
  {
    name: "status",
    aliases: ["s"],
    description: "Show current run status",
    handler: (_args, _dispatch, { addMessage }) => {
      const run = getLatestRun();
      if (!run) {
        addMessage({ id: `status-${Date.now()}`, type: "system", text: "No runs yet.", timestamp: Date.now() });
        return;
      }
      const passed = run.results.filter((r) => r.exitCode === 0).length;
      const failed = run.results.filter((r) => r.exitCode !== 0).length;
      const cost = run.results.reduce((sum, r) => sum + r.costUsd, 0);
      const lines = [
        `Run: ${run.id} (${run.status})`,
        `Branch: ${run.branch}`,
        `Steps: ${run.results.length} (✓${passed} ✗${failed})`,
        `Cost: $${cost.toFixed(2)}`,
        `Intent: "${run.intent}"`,
      ];
      if (run.startedAt) lines.push(`Started: ${new Date(run.startedAt).toLocaleString()}`);
      if (run.finishedAt) lines.push(`Finished: ${new Date(run.finishedAt).toLocaleString()}`);
      addMessage({ id: `status-${Date.now()}`, type: "system", text: lines.join("\n"), timestamp: Date.now() });
    },
  },

  // ── Run management ──────────────────────────────────────────────
  {
    name: "log",
    aliases: ["l"],
    description: "Show latest run results",
    handler: (_args, _dispatch, { addMessage }) => {
      const run = getLatestRun();
      if (!run) {
        addMessage({ id: `log-${Date.now()}`, type: "system", text: "No runs yet.", timestamp: Date.now() });
        return;
      }
      const lines = [`Run ${run.id} — ${run.status}`, `Branch: ${run.branch}`, ""];
      for (let i = 0; i < run.results.length; i++) {
        const r = run.results[i];
        const icon = r.exitCode === 0 ? "✓" : "✗";
        const tests = r.testsPass ? "tests pass" : "tests fail";
        const dur = `${r.durationSeconds}s`;
        lines.push(`  ${icon} Step ${i + 1}: ${r.message.slice(0, 60)} (${tests}, ${dur}, $${r.costUsd.toFixed(2)})`);
      }
      const totalCost = run.results.reduce((s, r) => s + r.costUsd, 0);
      lines.push(`\nTotal: $${totalCost.toFixed(2)}`);
      addMessage({ id: `log-${Date.now()}`, type: "system", text: lines.join("\n"), timestamp: Date.now() });
    },
  },
  {
    name: "cost",
    aliases: ["$"],
    description: "Show API cost for latest run",
    handler: (_args, _dispatch, { addMessage, addToast }) => {
      const run = getLatestRun();
      if (!run) {
        addToast("No runs yet", "info");
        return;
      }
      const totalCost = run.results.reduce((s, r) => s + r.costUsd, 0);
      const stepCosts = run.results.map((r, i) => `  Step ${i + 1}: $${r.costUsd.toFixed(3)}`).join("\n");
      addMessage({
        id: `cost-${Date.now()}`,
        type: "system",
        text: `Total: $${totalCost.toFixed(2)} across ${run.results.length} steps\n${stepCosts}`,
        timestamp: Date.now(),
      });
    },
  },
  {
    name: "stop",
    description: "Stop the current run",
    handler: (_args, _dispatch, { addToast }) => {
      // Signal stop by writing PID file removal — the executor checks this
      try {
        const { PID_FILE } = require("../types.js");
        const { unlinkSync, existsSync } = require("fs");
        if (existsSync(PID_FILE)) {
          unlinkSync(PID_FILE);
          addToast("Stop signal sent", "warning");
        } else {
          addToast("No running session to stop", "info");
        }
      } catch {
        addToast("Could not stop — no active run", "info");
      }
    },
  },

  // ── Git ─────────────────────────────────────────────────────────
  {
    name: "diff",
    aliases: ["d"],
    description: "Show git diff of overnight branch",
    handler: (_args, _dispatch, { addMessage, addToast }) => {
      try {
        const diff = execSync("git diff --stat HEAD~1..HEAD 2>/dev/null || git diff --stat", {
          cwd: process.cwd(),
          stdio: "pipe",
          timeout: 5_000,
        }).toString().trim();
        if (diff) {
          addMessage({ id: `diff-${Date.now()}`, type: "tool", text: diff, timestamp: Date.now() });
        } else {
          addToast("No changes to show", "info");
        }
      } catch {
        addToast("Not in a git repository", "warning");
      }
    },
  },
  {
    name: "undo",
    description: "Revert the last overnight commit",
    handler: (_args, _dispatch, { addMessage, addToast }) => {
      try {
        const branch = execSync("git rev-parse --abbrev-ref HEAD", {
          cwd: process.cwd(),
          stdio: "pipe",
          timeout: 5_000,
        }).toString().trim();
        if (!branch.startsWith("overnight/")) {
          addToast("Not on an overnight branch — undo only works during runs", "warning");
          return;
        }
        const lastMsg = execSync("git log -1 --pretty=%s", {
          cwd: process.cwd(),
          stdio: "pipe",
          timeout: 5_000,
        }).toString().trim();
        execSync("git reset --soft HEAD~1", { cwd: process.cwd(), stdio: "pipe", timeout: 10_000 });
        execSync("git checkout -- .", { cwd: process.cwd(), stdio: "pipe", timeout: 10_000 });
        addMessage({
          id: `undo-${Date.now()}`,
          type: "system",
          text: `Reverted: "${lastMsg}"`,
          timestamp: Date.now(),
        });
        addToast("Last commit reverted", "success");
      } catch (err: any) {
        addToast(`Undo failed: ${err.message}`, "warning");
      }
    },
  },

  // ── Help ────────────────────────────────────────────────────────
  {
    name: "help",
    aliases: ["?", "h"],
    description: "Show commands and keybindings",
    handler: (_args, _dispatch, { addMessage }) => {
      const help = [
        "Keybindings:",
        "  Enter          Send message",
        "  Shift+Enter    New line",
        "  ↑/↓            Input history",
        "  ←/→            Move cursor",
        "  Ctrl+W         Delete word",
        "  Ctrl+U         Clear line",
        "  Ctrl+A/E       Home/End",
        "  Escape         Cancel / clear queue",
        "  Ctrl+C         Exit (double-press if busy)",
        "  Ctrl+L         Clear screen",
        "  Shift+Tab      Cycle ambition",
        "  Shift+↑        Enter scroll mode",
        "  Ctrl+V         Toggle compact/verbose",
        "",
        "Commands:",
        ...COMMANDS.map((c) => {
          const aliases = c.aliases?.length ? ` (${c.aliases.map((a) => "/" + a).join(", ")})` : "";
          return `  /${c.name.padEnd(12)} ${c.description}${aliases}`;
        }),
      ].join("\n");
      addMessage({ id: `help-${Date.now()}`, type: "system", text: help, timestamp: Date.now() });
    },
  },
];

/** Get all commands for the dropdown */
export function getAllCommands(): { name: string; description: string }[] {
  return COMMANDS.map((c) => ({ name: c.name, description: c.description }));
}

/** Match user input against slash commands. */
export function matchCommand(input: string): { command: SlashCommand; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const spaceIdx = trimmed.indexOf(" ");
  const name = (spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

  for (const cmd of COMMANDS) {
    if (cmd.name === name || cmd.aliases?.includes(name)) {
      return { command: cmd, args };
    }
  }
  return null;
}

/** Get all command names for tab completion. */
export function getCommandNames(): string[] {
  return COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]);
}

/** Tab-complete a partial slash command. */
export function tabComplete(input: string): string | null {
  if (!input.startsWith("/")) return null;
  const partial = input.slice(1).toLowerCase();
  if (!partial) return null;

  const matches = getCommandNames().filter((n) => n.startsWith(partial));
  if (matches.length === 1) return `/${matches[0]} `;
  return null;
}
