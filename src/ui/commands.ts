/**
 * Slash command registry for the overnight TUI.
 */

import type { AppAction, Message } from "./types.js";

export interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  handler: (
    args: string,
    dispatch: (action: AppAction) => void,
    extra: {
      addMessage: (msg: Message) => void;
      onCompact?: () => Promise<void>;
      onClear?: () => void;
    },
  ) => void | Promise<void>;
}

const COMMANDS: SlashCommand[] = [
  {
    name: "clear",
    description: "Clear conversation history",
    handler: (_args, dispatch, { addMessage, onClear }) => {
      dispatch({ type: "CLEAR_MESSAGES" });
      onClear?.();
      addMessage({ id: `sys-${Date.now()}`, type: "system", text: "Conversation cleared.", timestamp: Date.now() });
    },
  },
  {
    name: "compact",
    description: "Compress conversation context",
    handler: async (_args, _dispatch, { addMessage, onCompact }) => {
      addMessage({ id: `sys-${Date.now()}`, type: "system", text: "Compressing context...", timestamp: Date.now() });
      if (onCompact) {
        await onCompact();
      } else {
        addMessage({ id: `sys-${Date.now()}`, type: "system", text: "Context compression not available.", timestamp: Date.now() });
      }
    },
  },
  {
    name: "help",
    aliases: ["?"],
    description: "Show available commands and keybindings",
    handler: (_args, _dispatch, { addMessage }) => {
      const help = [
        "Keybindings:",
        "  Enter          Submit message",
        "  Shift+Enter    New line",
        "  Up/Down        Input history",
        "  Escape         Cancel generation / clear queue",
        "  Ctrl+C         Exit (double-press if busy)",
        "  Ctrl+L         Clear screen",
        "  Shift+Tab      Cycle ambition level",
        "  Ctrl+V         Toggle compact/verbose",
        "",
        "Commands:",
        ...COMMANDS.map((c) => `  /${c.name.padEnd(14)} ${c.description}`),
      ].join("\n");
      addMessage({ id: `help-${Date.now()}`, type: "system", text: help, timestamp: Date.now() });
    },
  },
  {
    name: "verbose",
    description: "Toggle compact/verbose display mode",
    handler: (_args, dispatch, { addMessage }) => {
      dispatch({ type: "TOGGLE_DISPLAY_MODE" });
      addMessage({ id: `sys-${Date.now()}`, type: "system", text: "Display mode toggled.", timestamp: Date.now() });
    },
  },
];

/**
 * Match user input against slash commands.
 * Returns the command and args, or null if no match.
 */
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

/**
 * Tab-complete a partial slash command.
 * Returns the completed text or null if no match.
 */
export function tabComplete(input: string): string | null {
  if (!input.startsWith("/")) return null;
  const partial = input.slice(1).toLowerCase();
  if (!partial) return null;

  const matches = getCommandNames().filter((n) => n.startsWith(partial));
  if (matches.length === 1) return `/${matches[0]} `;
  return null;
}
