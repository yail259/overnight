/**
 * Theme system — semantic color roles mapped to ANSI names.
 *
 * Palette aligned with workovernight.com landing page:
 *   void/#050505  → terminal background (implicit)
 *   cream/#ede9e3 → white (primary text)
 *   cream-dim     → gray (secondary text, ANSI bright black / color 8)
 *   cream-faint   → dim (chrome, separators)
 *   moon/#7dd3fc  → cyan (accent — restricted to section labels + interactive)
 *   signal/#4ade80 → green (success)
 *   warm/#fbbf24  → yellow (warnings)
 *   hot/#f87171   → red (errors, yolo)
 *
 * Four-level hierarchy (matches landing page typography):
 *   1. bold white  — display: headings, key values, user input
 *   2. white       — subhead: descriptions, assistant text
 *   3. gray        — body: metadata, hints, timestamps
 *   4. dim         — chrome: separators, decorative elements only
 */

/** Text hierarchy */
export const TEXT = {
  /** Display tier — headings, user input, key values. Use with bold. */
  primary: "white",
  /** Subhead tier — regular content, descriptions */
  secondary: "white",
  /** Body tier — hints, metadata. ANSI bright black, readable on dark bg. */
  muted: "gray",
} as const;

/** Semantic colors — meaning, not decoration */
export const SEMANTIC = {
  /** Interactive elements, section labels, user prompt — moon blue */
  accent: "cyan",
  /** Success states, passed checks, completions — signal green */
  success: "green",
  /** Warnings, rate limits, attention — warm amber */
  warning: "yellow",
  /** Errors, failures, yolo — hot red */
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
  moon: "☽",
} as const;

/** Ambition level → semantic color */
export const AMBITION_COLOR: Record<string, string> = {
  tidy: TEXT.muted,
  refine: SEMANTIC.accent,
  build: SEMANTIC.success,
  radical: SEMANTIC.danger,
};
