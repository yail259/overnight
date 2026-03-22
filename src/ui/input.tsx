/**
 * Custom multi-line text input component.
 * Supports multi-line editing, input history, tab completion.
 *
 * No dimColor on readable text — only on the separator line.
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import type { AmbitionLevel } from "../types.js";
import type { InputHistory } from "./history.js";
import { tabComplete } from "./commands.js";
import { TEXT, SEMANTIC, CHROME, AMBITION_COLOR } from "./theme.js";

export function InputBar({
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
  const [cursorPos, setCursorPos] = useState(0);

  const handleInput = useCallback(
    (ch: string, key: any) => {
      if (key.ctrl && ch === "c") return;
      if (key.ctrl && ch === "l") return;
      if (key.shift && key.tab) return;
      if (key.ctrl && ch === "v") return;

      if (key.tab && !key.shift) {
        const completed = tabComplete(input);
        if (completed) {
          setInput(completed);
          setCursorPos(completed.length);
        }
        return;
      }

      if (key.return) {
        if (key.shift || key.meta) {
          setInput(input + "\n");
          setCursorPos(input.length + 1);
          history.reset();
          return;
        }
        onSubmit(input);
        setCursorPos(0);
        return;
      }

      if (key.escape) return;

      if (key.upArrow) {
        const lines = input.split("\n");
        if (lines.length <= 1) {
          const prev = history.navigateUp(input);
          if (prev !== null) {
            setInput(prev);
            setCursorPos(prev.length);
          }
        }
        return;
      }

      if (key.downArrow) {
        const lines = input.split("\n");
        if (lines.length <= 1) {
          const next = history.navigateDown();
          if (next !== null) {
            setInput(next);
            setCursorPos(next.length);
          }
        }
        return;
      }

      if (key.backspace || key.delete) {
        if (input.length > 0) {
          setInput(input.slice(0, -1));
          setCursorPos(Math.max(0, cursorPos - 1));
        }
        history.reset();
        return;
      }

      if (ch && !key.ctrl && !key.meta) {
        setInput(input + ch);
        setCursorPos(input.length + ch.length);
        history.reset();
        return;
      }
    },
    [input, setInput, onSubmit, cursorPos, history],
  );

  useInput(handleInput, { isActive: true });

  const lines = input.split("\n");
  const isMultiLine = lines.length > 1;
  const ambColor = AMBITION_COLOR[ambition] ?? TEXT.muted;
  const placeholder = loading
    ? "Type to queue a message…"
    : "Enter for suggestions, or describe your plan";

  return (
    <Box flexShrink={0} flexDirection="column" marginTop={1}>
      {/* Separator — only place dimColor is used */}
      <Box marginLeft={2} marginRight={2}>
        <Text color={TEXT.muted} dimColor>{CHROME.separator.repeat(60)}</Text>
      </Box>

      {/* Input area */}
      <Box flexDirection="column">
        {lines.length <= 1 ? (
          <Box marginLeft={2}>
            <Text color={SEMANTIC.accent} bold>{CHROME.prompt + " "}</Text>
            {input ? (
              <Text color={TEXT.primary}>{input}</Text>
            ) : (
              <Text color={TEXT.muted}>{placeholder}</Text>
            )}
          </Box>
        ) : (
          lines.map((line, i) => (
            <Box key={i} marginLeft={2}>
              <Text color={SEMANTIC.accent} bold>
                {i === 0 ? CHROME.prompt + " " : "  "}
              </Text>
              <Text color={TEXT.primary}>{line}</Text>
            </Box>
          ))
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
