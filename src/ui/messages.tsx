/**
 * Message rendering with markdown support, timestamps, and display modes.
 *
 * No dimColor on any readable text. Hierarchy via bold/color only.
 */

import React from "react";
import { Box, Text } from "ink";
import type { Message, DisplayMode } from "./types.js";
import { renderMarkdown } from "./markdown.js";
import { useTerminalWidth } from "./hooks.js";
import { TEXT, SEMANTIC, CHROME } from "./theme.js";

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

    case "tool":
      return (
        <Box marginLeft={2}>
          {timestamp}
          <Text color={SEMANTIC.tool}>{`  ${CHROME.gear} `}</Text>
          <Text color={TEXT.muted}>{msg.text}</Text>
        </Box>
      );

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
