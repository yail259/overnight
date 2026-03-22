/**
 * Markdown rendering for terminal output.
 * Uses marked + marked-terminal for formatting, cli-highlight for code blocks.
 */

import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { highlight } from "cli-highlight";

let markedInstance: Marked | null = null;

function getMarked(width: number): Marked {
  // Recreate each time to respect width changes
  const m = new Marked();
  m.use(
    markedTerminal({
      width,
      reflowText: true,
      showSectionPrefix: false,
      tab: 2,
      code: (code: string, lang?: string) => {
        try {
          if (lang) {
            return highlight(code, { language: lang });
          }
          return highlight(code, {});
        } catch {
          return code;
        }
      },
    }) as any,
  );
  return m;
}

/**
 * Render markdown text to terminal-formatted ANSI string.
 */
export function renderMarkdown(text: string, width: number = 80): string {
  try {
    const m = getMarked(width);
    const result = m.parse(text) as string;
    // Trim trailing newlines that marked adds
    return result.replace(/\n+$/, "");
  } catch {
    // Fallback to plain text on parse error
    return text;
  }
}

/**
 * Render a diff string with colors.
 * Lines starting with + are green, - are red, @@ are cyan.
 */
export function renderDiff(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (line.startsWith("+++") || line.startsWith("---")) return `\x1b[1m${line}\x1b[0m`;
      if (line.startsWith("+")) return `\x1b[32m${line}\x1b[0m`;
      if (line.startsWith("-")) return `\x1b[31m${line}\x1b[0m`;
      if (line.startsWith("@@")) return `\x1b[36m${line}\x1b[0m`;
      return line;
    })
    .join("\n");
}
