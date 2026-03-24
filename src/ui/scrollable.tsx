/**
 * ScrollableMessages — renders message history with auto-scroll-to-bottom
 * and manual scroll support. Inspired by Gemini CLI's Scrollable but
 * built on Ink's native APIs without their context/hook dependencies.
 *
 * Uses output slicing (not CSS overflow) since Ink 6.x doesn't support
 * overflowY: "scroll". Messages are rendered into a fixed viewport that
 * shows the most recent N lines, with scroll-up via Shift+Up/Down.
 */

import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useStdout } from "ink";
import type { Message, DisplayMode } from "./types.js";
import { MessageLine } from "./messages.js";
import { useTerminalWidth } from "./hooks.js";
import { TEXT, CHROME } from "./theme.js";

interface ScrollableMessagesProps {
  messages: Message[];
  displayMode: DisplayMode;
  /** Whether the user is in scroll mode */
  scrollMode: boolean;
  /** Current scroll offset from bottom (0 = at bottom) */
  scrollOffset: number;
  /** Height reserved for footer (status bar, input, etc.) */
  footerHeight?: number;
}

export function ScrollableMessages({
  messages,
  displayMode,
  scrollMode,
  scrollOffset,
  footerHeight = 8,
}: ScrollableMessagesProps) {
  const { stdout } = useStdout();
  const width = useTerminalWidth();
  const terminalRows = stdout?.rows ?? 24;

  // Reserve space for footer elements
  const viewportHeight = Math.max(5, terminalRows - footerHeight);

  // Calculate which messages to show
  const totalMessages = messages.length;
  const endIdx = Math.max(0, totalMessages - scrollOffset);
  const startIdx = Math.max(0, endIdx - viewportHeight);
  const visibleMessages = messages.slice(startIdx, endIdx);

  // Scroll position indicator
  const isAtBottom = scrollOffset === 0;
  const isAtTop = startIdx === 0;
  const hasOverflow = totalMessages > viewportHeight;

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Scroll-up indicator */}
      {hasOverflow && !isAtTop && (
        <Box marginLeft={2}>
          <Text color={TEXT.muted}>
            {"  ↑ " + (startIdx) + " more messages"}
          </Text>
        </Box>
      )}

      {/* Visible messages */}
      {visibleMessages.map((msg) => (
        <MessageLine key={msg.id} msg={msg} displayMode={displayMode} width={width} />
      ))}

      {/* Scroll mode indicator */}
      {scrollMode && (
        <Box marginLeft={2}>
          <Text color={TEXT.muted}>
            {"  ↑↓ scroll " + CHROME.dot + " Esc exit " + CHROME.dot + " "}
            {`${startIdx + 1}–${endIdx} of ${totalMessages}`}
          </Text>
        </Box>
      )}

      {/* New messages indicator when scrolled up */}
      {hasOverflow && !isAtBottom && !scrollMode && (
        <Box marginLeft={2}>
          <Text color={TEXT.muted}>
            {"  ↓ " + scrollOffset + " new — Shift+↑ to scroll"}
          </Text>
        </Box>
      )}
    </Box>
  );
}
