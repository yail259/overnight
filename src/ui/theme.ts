/**
 * Theme system — semantic color roles mapped to ANSI names.
 *
 * Uses ANSI palette names so the terminal's color scheme controls RGB values.
 *
 * Hierarchy via bold/color, NOT dimColor. dimColor is nearly invisible
 * on many dark terminals — only used for separator lines.
 *
 * Three readable tiers:
 *   1. bold white  — primary emphasis (user input, headings)
 *   2. white       — regular content (assistant text, descriptions)
 *   3. gray        — secondary info (timestamps, metadata, hints)
 *      "gray" = ANSI bright black (color 8), readable on dark backgrounds
 */

/** Text hierarchy — bold vs regular weight, no gray, no dim */
export const TEXT = {
  /** Highest emphasis — headings, user input, key values. Use with bold. */
  primary: "white",
  /** Regular content — assistant text, descriptions */
  secondary: "white",
  /** Chrome, hints, metadata — regular white, position provides hierarchy */
  muted: "white",
} as const;

/** Semantic colors — meaning, not decoration */
export const SEMANTIC = {
  /** Interactive elements, user input prompt */
  accent: "cyan",
  /** Success states, passed checks */
  success: "green",
  /** Warnings, attention needed */
  warning: "yellow",
  /** Errors, failures */
  danger: "red",
  /** Tool calls, meta operations */
  tool: "magenta",
} as const;

/** Structural characters */
export const CHROME = {
  separator: "─",
  dot: "·",
  prompt: "❯",
  bullet: "◆",
  gear: "⚙",
  arrow: "→",
  cursor: "▎",
  radioOn: "◉",
  radioOff: "○",
  pointer: "▸",
} as const;

/** Ambition level → semantic color */
export const AMBITION_COLOR: Record<string, string> = {
  safe: SEMANTIC.accent,
  normal: TEXT.muted,
  yolo: SEMANTIC.danger,
};
