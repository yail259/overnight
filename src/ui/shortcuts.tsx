/**
 * ShortcutsBar — contextual keyboard shortcuts display.
 * Shows different shortcuts based on current TUI state.
 */

import React from "react";
import { Box, Text } from "ink";
import { TEXT, CHROME } from "./theme.js";

interface ShortcutsBarProps {
  isStreaming: boolean;
  isLoading: boolean;
  hasApproval: boolean;
  hasQueue: boolean;
  isScrollMode: boolean;
}

function Shortcut({ keys, label }: { keys: string; label: string }) {
  return (
    <Text color={TEXT.muted}>
      <Text color={TEXT.muted} bold>{keys}</Text>
      {" " + label}
    </Text>
  );
}

function Separator() {
  return <Text color={TEXT.muted}>{" " + CHROME.dot + " "}</Text>;
}

export function ShortcutsBar({
  isStreaming,
  isLoading,
  hasApproval,
  hasQueue,
  isScrollMode,
}: ShortcutsBarProps) {
  if (isScrollMode) {
    return (
      <Box marginLeft={4}>
        <Shortcut keys="↑↓" label="scroll" />
        <Separator />
        <Shortcut keys="Esc" label="exit" />
      </Box>
    );
  }

  if (hasApproval) {
    return (
      <Box marginLeft={4}>
        <Shortcut keys="←→" label="select mode" />
        <Separator />
        <Shortcut keys="↵" label="go" />
        <Separator />
        <Shortcut keys="Esc" label="cancel" />
      </Box>
    );
  }

  if (isStreaming) {
    return (
      <Box marginLeft={4}>
        <Shortcut keys="Esc" label="cancel" />
        <Separator />
        <Shortcut keys="⇧Tab" label="ambition" />
      </Box>
    );
  }

  if (isLoading) {
    return (
      <Box marginLeft={4}>
        <Shortcut keys="type" label="to queue" />
        <Separator />
        <Shortcut keys="Esc" label="cancel" />
        <Separator />
        <Shortcut keys="⇧Tab" label="ambition" />
      </Box>
    );
  }

  return (
    <Box marginLeft={4}>
      <Shortcut keys="↵" label="send" />
      <Separator />
      <Shortcut keys="⇧↵" label="newline" />
      <Separator />
      <Shortcut keys="⇧Tab" label="ambition" />
      <Separator />
      <Shortcut keys="/" label="commands" />
      {hasQueue && (
        <>
          <Separator />
          <Shortcut keys="Esc" label="clear queue" />
        </>
      )}
    </Box>
  );
}
