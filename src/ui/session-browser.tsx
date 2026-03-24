/**
 * SessionBrowser — browsable list of past sessions for --resume.
 * Shows timestamp, first user message (intent), message count.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { SessionData } from "./types.js";
import { TEXT, SEMANTIC, CHROME } from "./theme.js";

interface SessionBrowserProps {
  sessions: SessionData[];
  onSelect: (session: SessionData) => void;
  onCancel: () => void;
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getSessionIntent(session: SessionData): string {
  // Find first user message as the intent
  const userMsg = session.messages.find((m) => m.type === "user");
  if (!userMsg) return "(empty session)";
  const text = userMsg.text;
  return text.length > 60 ? text.slice(0, 57) + "..." : text;
}

export function SessionBrowser({ sessions, onSelect, onCancel }: SessionBrowserProps) {
  const [selected, setSelected] = useState(0);

  useInput((_ch, key) => {
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) setSelected((s) => Math.min(sessions.length - 1, s + 1));
    if (key.return) onSelect(sessions[selected]);
    if (key.escape) onCancel();
  });

  if (sessions.length === 0) {
    return (
      <Box marginLeft={2} flexDirection="column" padding={1}>
        <Text color={TEXT.muted}>{CHROME.bullet} No previous sessions found.</Text>
        <Text color={TEXT.muted}>{"  Start a conversation first, then use --resume."}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginLeft={2} marginBottom={1}>
        <Text color={TEXT.muted}>{"Resume a session "}</Text>
        <Text color={TEXT.muted}>{CHROME.dot + " ↑↓ select " + CHROME.dot + " ↵ resume " + CHROME.dot + " Esc cancel"}</Text>
      </Box>
      {sessions.slice(0, 10).map((session, i) => {
        const isActive = i === selected;
        const intent = getSessionIntent(session);
        const msgCount = session.messages.filter((m) => m.type === "user").length;
        const time = formatRelativeTime(session.updatedAt || session.createdAt);

        return (
          <Box key={session.id} marginLeft={2} gap={1}>
            <Text color={isActive ? SEMANTIC.accent : TEXT.muted}>
              {isActive ? CHROME.pointer : " "}
            </Text>
            <Text color={isActive ? TEXT.primary : TEXT.secondary} bold={isActive}>
              {intent}
            </Text>
            <Text color={TEXT.muted}>
              {`${msgCount} msgs ${CHROME.dot} ${time}`}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
