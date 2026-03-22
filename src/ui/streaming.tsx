/**
 * StreamingArea — shows live streaming text with animated cursor and word wrap.
 * No dimColor — all text is readable.
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

  const maxWidth = Math.max(40, width - 6);
  let displayText = text;
  try {
    const lines = text.split("\n");
    const wrapped: string[] = [];
    for (const line of lines) {
      if (line.length <= maxWidth) {
        wrapped.push(line);
      } else {
        let remaining = line;
        while (remaining.length > maxWidth) {
          let breakAt = remaining.lastIndexOf(" ", maxWidth);
          if (breakAt <= 0) breakAt = maxWidth;
          wrapped.push(remaining.slice(0, breakAt));
          remaining = remaining.slice(breakAt).trimStart();
        }
        if (remaining) wrapped.push(remaining);
      }
    }
    const maxLines = Math.min(20, Math.floor((process.stdout.rows || 24) / 2));
    displayText = wrapped.slice(-maxLines).join("\n");
  } catch {
    displayText = text;
  }

  return (
    <Box flexShrink={0} marginLeft={2} flexDirection="column" marginTop={1}>
      <Text color={TEXT.secondary}>{"  " + displayText}</Text>
      <Box>
        <Text color={SEMANTIC.accent}>
          {"    " + (cursorVisible ? CHROME.cursor : " ")}
        </Text>
      </Box>
    </Box>
  );
}
