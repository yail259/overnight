/**
 * StreamingArea — shows live streaming text with animated cursor,
 * word wrap, and basic inline formatting awareness.
 *
 * Detects code blocks in progress and applies dimmer styling to
 * distinguish code from prose during streaming.
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { useTerminalWidth } from "./hooks.js";
import { TEXT, SEMANTIC, CHROME } from "./theme.js";

export function StreamingArea({ text }: { text: string }) {
  const [cursorVisible, setCursorVisible] = useState(true);
  const width = useTerminalWidth();

  useEffect(() => {
    const timer = setInterval(() => setCursorVisible((v) => !v), 530);
    return () => clearInterval(timer);
  }, []);

  const maxWidth = Math.max(40, width - 8);
  const maxLines = Math.min(20, Math.floor((process.stdout.rows || 24) / 2));

  // Split into lines and detect code blocks
  const rawLines = text.split("\n");
  const displayLines: { text: string; isCode: boolean }[] = [];
  let inCodeBlock = false;

  for (const line of rawLines) {
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      displayLines.push({ text: line, isCode: true });
      continue;
    }

    // Word wrap
    if (line.length <= maxWidth) {
      displayLines.push({ text: line, isCode: inCodeBlock });
    } else {
      let remaining = line;
      while (remaining.length > maxWidth) {
        let breakAt = remaining.lastIndexOf(" ", maxWidth);
        if (breakAt <= 0) breakAt = maxWidth;
        displayLines.push({ text: remaining.slice(0, breakAt), isCode: inCodeBlock });
        remaining = remaining.slice(breakAt).trimStart();
      }
      if (remaining) displayLines.push({ text: remaining, isCode: inCodeBlock });
    }
  }

  // Show last N lines
  const visible = displayLines.slice(-maxLines);

  return (
    <Box flexShrink={0} marginLeft={2} flexDirection="column" marginTop={1}>
      {visible.map((line, i) => (
        <Box key={i} marginLeft={2}>
          {line.isCode ? (
            <Text color={TEXT.muted}>{line.text}</Text>
          ) : (
            <Text color={TEXT.secondary}>{line.text}</Text>
          )}
        </Box>
      ))}
      <Box marginLeft={2}>
        <Text color={SEMANTIC.accent}>
          {cursorVisible ? CHROME.cursor : " "}
        </Text>
      </Box>
    </Box>
  );
}
