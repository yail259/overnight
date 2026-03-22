/**
 * Shared hooks for the overnight TUI.
 */

import { useState, useEffect } from "react";
import { useStdout } from "ink";

/** Get terminal width, auto-updating on resize. */
export function useTerminalWidth(): number {
  const { stdout } = useStdout();
  const [width, setWidth] = useState(stdout?.columns ?? 80);

  useEffect(() => {
    if (!stdout) return;
    const handler = () => setWidth(stdout.columns);
    stdout.on("resize", handler);
    return () => { stdout.off("resize", handler); };
  }, [stdout]);

  return width;
}

/** Elapsed seconds timer that ticks every second. */
export function useElapsedTimer(startedAt: number, active: boolean): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) return;
    const tick = () => setElapsed(Math.round((Date.now() - startedAt) / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [startedAt, active]);

  return elapsed;
}
