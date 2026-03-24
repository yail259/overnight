/**
 * TextInputBar — proper text input with cursor navigation.
 *
 * Inspired by Gemini CLI's text-buffer but drastically simpler:
 * - Left/right arrow cursor movement
 * - Home/End jump to start/end
 * - Ctrl+W to delete word backwards
 * - Ctrl+U to clear line
 * - Ctrl+A / Ctrl+E for home/end
 * - Backspace at cursor position (not just end)
 * - Multi-line via Shift+Enter
 * - Input history via Up/Down arrows
 * - Visual cursor via chalk.inverse
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import chalk from "chalk";
import type { AmbitionLevel } from "../types.js";
import type { InputHistory } from "./history.js";
import { tabComplete } from "./commands.js";
import { TEXT, SEMANTIC, CHROME, AMBITION_COLOR } from "./theme.js";

export function TextInputBar({
  input,
  setInput,
  onSubmit,
  loading,
  ambition,
  queueCount,
  history,
}: {
  input: string;
  setInput: (v: string) => void;
  onSubmit: (v: string) => void;
  loading: boolean;
  ambition: AmbitionLevel;
  queueCount: number;
  history: InputHistory;
}) {
  const [cursor, setCursor] = useState(0);

  // Keep cursor in bounds when input changes externally
  const safeCursor = Math.min(cursor, input.length);

  const insertAt = useCallback(
    (text: string, ch: string) => {
      const pos = Math.min(cursor, text.length);
      const next = text.slice(0, pos) + ch + text.slice(pos);
      setInput(next);
      setCursor(pos + ch.length);
    },
    [cursor, setInput],
  );

  const deleteBack = useCallback(
    (text: string) => {
      const pos = Math.min(cursor, text.length);
      if (pos === 0) return;
      const next = text.slice(0, pos - 1) + text.slice(pos);
      setInput(next);
      setCursor(pos - 1);
    },
    [cursor, setInput],
  );

  const deleteWordBack = useCallback(
    (text: string) => {
      const pos = Math.min(cursor, text.length);
      if (pos === 0) return;
      // Skip trailing spaces, then delete word
      let i = pos - 1;
      while (i > 0 && text[i - 1] === " ") i--;
      while (i > 0 && text[i - 1] !== " ") i--;
      const next = text.slice(0, i) + text.slice(pos);
      setInput(next);
      setCursor(i);
    },
    [cursor, setInput],
  );

  const setInputAndCursor = useCallback(
    (text: string) => {
      setInput(text);
      setCursor(text.length);
    },
    [setInput],
  );

  const handleInput = useCallback(
    (ch: string, key: any) => {
      // Pass through to global handlers
      if (key.ctrl && ch === "c") return;
      if (key.ctrl && ch === "l") return;
      if (key.shift && key.tab) return;
      if (key.ctrl && ch === "v") return;

      // Tab completion
      if (key.tab && !key.shift) {
        const completed = tabComplete(input);
        if (completed) setInputAndCursor(completed);
        return;
      }

      // Submit
      if (key.return) {
        if (key.shift || key.meta) {
          insertAt(input, "\n");
          history.reset();
          return;
        }
        onSubmit(input);
        setCursor(0);
        return;
      }

      if (key.escape) return;

      // Cursor movement
      if (key.leftArrow) {
        if (key.ctrl || key.meta) {
          // Word left
          let i = Math.min(safeCursor, input.length) - 1;
          while (i > 0 && input[i - 1] === " ") i--;
          while (i > 0 && input[i - 1] !== " ") i--;
          setCursor(Math.max(0, i));
        } else {
          setCursor(Math.max(0, safeCursor - 1));
        }
        return;
      }

      if (key.rightArrow) {
        if (key.ctrl || key.meta) {
          // Word right
          let i = safeCursor;
          while (i < input.length && input[i] !== " ") i++;
          while (i < input.length && input[i] === " ") i++;
          setCursor(i);
        } else {
          setCursor(Math.min(input.length, safeCursor + 1));
        }
        return;
      }

      // History navigation (only when single-line and cursor at end)
      if (key.upArrow) {
        const lines = input.split("\n");
        if (lines.length <= 1) {
          const prev = history.navigateUp(input);
          if (prev !== null) setInputAndCursor(prev);
        }
        return;
      }

      if (key.downArrow) {
        const lines = input.split("\n");
        if (lines.length <= 1) {
          const next = history.navigateDown();
          if (next !== null) setInputAndCursor(next);
        }
        return;
      }

      // Ctrl shortcuts
      if (key.ctrl && ch === "a") { setCursor(0); return; }
      if (key.ctrl && ch === "e") { setCursor(input.length); return; }
      if (key.ctrl && ch === "u") { setInput(""); setCursor(0); return; }
      if (key.ctrl && ch === "w") { deleteWordBack(input); history.reset(); return; }
      if (key.ctrl && ch === "k") {
        // Kill to end of line
        setInput(input.slice(0, safeCursor));
        return;
      }

      // Backspace / Delete
      if (key.backspace || key.delete) {
        deleteBack(input);
        history.reset();
        return;
      }

      // Regular character
      if (ch && !key.ctrl && !key.meta) {
        insertAt(input, ch);
        history.reset();
        return;
      }
    },
    [input, setInput, onSubmit, safeCursor, history, insertAt, deleteBack, deleteWordBack, setInputAndCursor],
  );

  useInput(handleInput, { isActive: true });

  // Render input with visual cursor
  const lines = input.split("\n");
  const isMultiLine = lines.length > 1;
  const ambColor = AMBITION_COLOR[ambition] ?? TEXT.muted;
  const placeholder = loading
    ? "Type to queue a message…"
    : "Enter for suggestions, or describe your plan";

  // Build display with cursor
  function renderWithCursor(text: string, cursorPos: number): string {
    const pos = Math.min(cursorPos, text.length);
    const before = text.slice(0, pos);
    const cursorChar = pos < text.length ? text[pos] : " ";
    const after = pos < text.length ? text.slice(pos + 1) : "";
    return before + chalk.inverse(cursorChar) + after;
  }

  return (
    <Box flexShrink={0} flexDirection="column" marginTop={1}>
      {/* Separator */}
      <Box marginLeft={2} marginRight={2}>
        <Text color={TEXT.muted} dimColor>{CHROME.separator.repeat(60)}</Text>
      </Box>

      {/* Input area */}
      <Box flexDirection="column">
        {lines.length <= 1 ? (
          <Box marginLeft={2}>
            <Text color={SEMANTIC.accent} bold>{CHROME.prompt + " "}</Text>
            {input ? (
              <Text>{renderWithCursor(input, safeCursor)}</Text>
            ) : (
              <Text color={TEXT.muted}>{chalk.inverse(" ")}{placeholder.slice(1)}</Text>
            )}
          </Box>
        ) : (
          lines.map((line, i) => {
            // Calculate cursor position within this line
            let lineStart = 0;
            for (let j = 0; j < i; j++) lineStart += lines[j].length + 1;
            const lineEnd = lineStart + line.length;
            const cursorInLine = safeCursor >= lineStart && safeCursor <= lineEnd;
            const localCursor = safeCursor - lineStart;

            return (
              <Box key={i} marginLeft={2}>
                <Text color={SEMANTIC.accent} bold>
                  {i === 0 ? CHROME.prompt + " " : "  "}
                </Text>
                <Text>
                  {cursorInLine ? renderWithCursor(line, localCursor) : line}
                </Text>
              </Box>
            );
          })
        )}
      </Box>

      {/* Hints bar */}
      <Box marginLeft={4}>
        {isMultiLine && (
          <>
            <Text color={TEXT.muted}>{`${lines.length} lines`}</Text>
            <Text color={TEXT.muted}>{` ${CHROME.dot} `}</Text>
          </>
        )}
        {queueCount > 0 && (
          <>
            <Text color={SEMANTIC.warning} bold>{`${queueCount} queued`}</Text>
            <Text color={TEXT.muted}>{` ${CHROME.dot} `}</Text>
          </>
        )}
        <Text color={ambColor}>{ambition}</Text>
        <Text color={TEXT.muted}>{` ${CHROME.dot} ⇧Tab mode`}</Text>
      </Box>
    </Box>
  );
}
