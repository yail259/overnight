/**
 * Toast — transient messages that appear above the input and auto-dismiss.
 * Replaces permanent system messages for ephemeral feedback.
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { TEXT, SEMANTIC } from "./theme.js";

export interface ToastMessage {
  id: string;
  text: string;
  type: "info" | "warning" | "success";
  expiresAt: number; // Date.now() + duration
}

export function ToastDisplay({ toasts }: { toasts: ToastMessage[] }) {
  const now = Date.now();
  const active = toasts.filter((t) => t.expiresAt > now);
  if (active.length === 0) return null;

  const colorMap = {
    info: TEXT.muted,
    warning: SEMANTIC.warning,
    success: SEMANTIC.success,
  };

  // Show only the most recent toast
  const toast = active[active.length - 1];

  return (
    <Box marginLeft={2}>
      <Text color={colorMap[toast.type]}>{toast.text}</Text>
    </Box>
  );
}

/** Create a toast message with auto-expire */
export function createToast(
  text: string,
  type: "info" | "warning" | "success" = "info",
  durationMs: number = 3000,
): ToastMessage {
  return {
    id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
    text,
    type,
    expiresAt: Date.now() + durationMs,
  };
}
