/**
 * Message rendering with markdown support, diff detection, timestamps, and display modes.
 */

import React from "react";
import { Box, Text } from "ink";
import type { Message, DisplayMode } from "./types.js";
import { renderMarkdown, renderDiff } from "./markdown.js";
import { useTerminalWidth } from "./hooks.js";
import { TEXT, SEMANTIC, CHROME } from "./theme.js";

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Detect if text contains a diff */
function containsDiff(text: string): boolean {
  const lines = text.split("\n");
  let diffLines = 0;
  for (const line of lines) {
    if (line.startsWith("+") || line.startsWith("-") || line.startsWith("@@") || line.startsWith("diff --git")) {
      diffLines++;
    }
    if (diffLines >= 3) return true;
  }
  return false;
}

/** Render a tool message, applying diff coloring when appropriate */
function renderToolText(text: string): string {
  if (containsDiff(text)) {
    return renderDiff(text);
  }
  return text;
}

export function MessageLine({
  msg,
  displayMode,
  width,
}: {
  msg: Message;
  displayMode: DisplayMode;
  width?: number;
}) {
  const termWidth = width ?? useTerminalWidth();
  const contentWidth = Math.max(40, termWidth - 8);

  if (displayMode === "compact" && msg.type === "tool") return null;

  const timestamp = displayMode === "verbose" && msg.timestamp ? (
    <Text color={TEXT.muted}>
      {formatTime(msg.timestamp) + " "}
    </Text>
  ) : null;

  switch (msg.type) {
    case "user":
      return (
        <Box marginLeft={2} marginTop={1}>
          {timestamp}
          <Text color={SEMANTIC.accent} bold>{CHROME.prompt + " "}</Text>
          <Text color={TEXT.primary} bold>{msg.text}</Text>
        </Box>
      );

    case "assistant": {
      let rendered: string;
      try {
        rendered = renderMarkdown(msg.text, contentWidth);
      } catch {
        rendered = msg.text;
      }

      if (displayMode === "compact" && rendered.length > 500) {
        const lines = rendered.split("\n");
        if (lines.length > 10) {
          rendered = lines.slice(0, 10).join("\n") + "\n  … /verbose to see full";
        }
      }

      return (
        <Box marginLeft={2} flexDirection="column" marginTop={1}>
          {timestamp && <Box>{timestamp}</Box>}
          <Text>{"  " + rendered}</Text>
        </Box>
      );
    }

    case "tool": {
      const toolText = renderToolText(msg.text);
      return (
        <Box marginLeft={2} flexDirection="column">
          {timestamp}
          <Box>
            <Text color={SEMANTIC.tool}>{`  ${CHROME.gear} `}</Text>
            <Text>{toolText}</Text>
          </Box>
        </Box>
      );
    }

    case "system":
      return (
        <Box marginLeft={2}>
          {timestamp}
          <Text color={TEXT.muted}>{`  ${CHROME.bullet} `}</Text>
          <Text color={TEXT.muted}>{msg.text}</Text>
        </Box>
      );

    default:
      return null;
  }
}
