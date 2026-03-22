/**
 * Status bar, thinking indicator, progress bar, run status, and retry countdown.
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { RunState } from "../types.js";
import { useTerminalWidth, useElapsedTimer } from "./hooks.js";
import { TEXT, SEMANTIC, CHROME, AMBITION_COLOR } from "./theme.js";

// ── Spinner ─────────────────────────────────────────────────────────

const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"];

export function ThinkingIndicator() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 150);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box marginLeft={2} marginTop={1}>
      <Text color={SEMANTIC.accent}>{SPINNER_FRAMES[frame]}</Text>
      <Text color={TEXT.secondary}>{" Thinking..."}</Text>
    </Box>
  );
}

// ── Progress bar ────────────────────────────────────────────────────

export function ProgressBar({ current, total, width = 30 }: { current: number; total: number; width?: number }) {
  if (total <= 0) return null;
  const ratio = current / total;
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const pct = Math.round(ratio * 100);

  return (
    <Box gap={1}>
      <Text color={SEMANTIC.accent}>{"█".repeat(filled)}</Text>
      <Text color={TEXT.muted}>{"░".repeat(empty)}</Text>
      <Text color={TEXT.muted}>{` ${pct}%`}</Text>
    </Box>
  );
}

// ── Format helpers ──────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

// ── Run status bar ───────────────────────────────────────────────────

export function RunStatusBar({ run }: { run: RunState }) {
  const elapsed = useElapsedTimer(
    run.startedAt,
    run.status === "running" || run.status === "starting",
  );

  const displayElapsed = run.status === "running" || run.status === "starting" ? elapsed : run.elapsed;

  const statusConfig = {
    completed: { icon: "✓", color: SEMANTIC.success, label: "Completed" },
    failed:    { icon: "✗", color: SEMANTIC.danger,  label: "Failed" },
    stopped:   { icon: "■", color: SEMANTIC.warning, label: "Stopped" },
    starting:  { icon: "◐", color: SEMANTIC.accent,  label: "Starting" },
    running:   { icon: "▶", color: SEMANTIC.accent,  label: "Running" },
  };

  const { icon, color, label } = statusConfig[run.status];
  const current = run.current + (run.status === "running" ? 1 : 0);
  const modeLabel = run.mode === "dont-stop" ? "Don't stop" : "Plan";

  return (
    <Box flexShrink={0} flexDirection="column" marginLeft={2} marginTop={1}>
      <Box gap={1}>
        <Text color={color} bold>{icon}</Text>
        <Text color={color} bold>{label}</Text>
        <Text color={TEXT.muted}>{CHROME.dot}</Text>
        <Text color={run.mode === "dont-stop" ? SEMANTIC.danger : SEMANTIC.accent}>{modeLabel}</Text>
        <Text color={TEXT.muted}>{CHROME.dot}</Text>
        {run.total > 0 && (
          <Text color={TEXT.secondary}>step {current}</Text>
        )}
        {run.passed > 0 && <Text color={SEMANTIC.success}>{"✓" + run.passed}</Text>}
        {run.failed > 0 && <Text color={SEMANTIC.danger}>{"✗" + run.failed}</Text>}
        <Text color={TEXT.muted}>{CHROME.dot}</Text>
        <Text color={TEXT.muted}>{formatDuration(displayElapsed)}</Text>
      </Box>
      {run.status === "running" && run.total > 0 && (
        <Box marginLeft={2}>
          <ProgressBar current={current} total={run.total} />
        </Box>
      )}
      {run.currentMessage && (
        <Box marginLeft={2}>
          <Text color={TEXT.muted}>
            {CHROME.arrow + " " + (run.currentMessage.length > 70 ? run.currentMessage.slice(0, 67) + "..." : run.currentMessage)}
          </Text>
        </Box>
      )}
    </Box>
  );
}

// ── Persistent status bar (model, ambition) ──────────────────────────

export function StatusBar({
  model,
  ambition,
  queueCount,
  contextUsed,
  contextMax,
}: {
  model: string;
  ambition: string;
  queueCount: number;
  contextUsed?: number;
  contextMax?: number;
}) {
  const width = useTerminalWidth();
  const ambColor = AMBITION_COLOR[ambition] ?? TEXT.muted;

  // Context indicator color
  let contextColor: string = SEMANTIC.success;
  if (contextUsed && contextMax) {
    const ratio = contextUsed / contextMax;
    if (ratio > 0.8) contextColor = SEMANTIC.danger;
    else if (ratio > 0.5) contextColor = SEMANTIC.warning;
  }

  return (
    <Box marginLeft={2}>
      <Text color={TEXT.muted}>{model}</Text>
      {contextUsed !== undefined && contextMax !== undefined && (
        <>
          <Text color={TEXT.muted}>{` ${CHROME.dot} `}</Text>
          <Text color={contextColor}>
            {formatTokens(contextUsed)}/{formatTokens(contextMax)}
          </Text>
        </>
      )}
      {queueCount > 0 && (
        <>
          <Text color={TEXT.muted}>{` ${CHROME.dot} `}</Text>
          <Text color={SEMANTIC.warning} bold>{`${queueCount} queued`}</Text>
        </>
      )}
      <Text color={TEXT.muted}>{` ${CHROME.dot} `}</Text>
      <Text color={ambColor}>{ambition}</Text>
    </Box>
  );
}

// ── Retry countdown ─────────────────────────────────────────────────

export function RetryCountdown({ countdown, attempt }: { countdown: number; attempt: number }) {
  const [remaining, setRemaining] = useState(countdown);

  useEffect(() => {
    setRemaining(countdown);
    const timer = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  return (
    <Box marginLeft={2} marginTop={1}>
      <Text color={SEMANTIC.warning}>{"⏳ "}</Text>
      <Text color={TEXT.secondary}>{"Rate limited — retrying in "}</Text>
      <Text color={TEXT.primary} bold>{remaining + "s"}</Text>
      <Text color={TEXT.muted}>{` (attempt ${attempt})`}</Text>
    </Box>
  );
}
