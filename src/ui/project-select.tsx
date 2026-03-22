/**
 * ProjectSelector — multi-select for cross-project mode.
 * No dimColor on readable text.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ProjectInfo } from "../types.js";
import { TEXT, SEMANTIC, CHROME } from "./theme.js";

function formatAge(date: Date): string {
  const ms = Date.now() - date.getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

export function ProjectSelector({
  projects,
  onConfirm,
}: {
  projects: ProjectInfo[];
  onConfirm: (selected: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(projects.slice(0, 5).map((_, i) => i)));
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow) setCursor((c) => Math.min(projects.length - 1, c + 1));
    else if (input === " ") {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(cursor)) next.delete(cursor);
        else next.add(cursor);
        return next;
      });
    } else if (key.return) {
      onConfirm(projects.filter((_, i) => selected.has(i)).map((p) => p.name));
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text color={TEXT.secondary}>{"  Select projects"}</Text>
      <Box marginLeft={2} marginBottom={1}>
        <Text color={TEXT.muted}>{"↑↓ move · Space toggle · Enter confirm"}</Text>
      </Box>
      {projects.map((p, i) => {
        const isCursor = i === cursor;
        const isSelected = selected.has(i);

        return (
          <Box key={p.cwd} marginLeft={2}>
            <Text color={isCursor ? SEMANTIC.accent : TEXT.muted}>
              {isCursor ? CHROME.pointer + " " : "  "}
            </Text>
            <Text color={isSelected ? SEMANTIC.success : TEXT.muted} bold={isSelected}>
              {isSelected ? CHROME.radioOn + " " : CHROME.radioOff + " "}
            </Text>
            <Text color={isCursor ? SEMANTIC.accent : TEXT.secondary} bold={isCursor}>
              {p.name.padEnd(20)}
            </Text>
            <Text color={TEXT.muted}>{`${formatAge(p.lastActive)} ${CHROME.dot} ${p.sessionCount} sessions`}</Text>
          </Box>
        );
      })}
      <Box marginLeft={2} marginTop={1}>
        <Text color={TEXT.muted}>
          {"Top 5 pre-selected. Press ↵ when ready."}
        </Text>
      </Box>
    </Box>
  );
}
