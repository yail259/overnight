/**
 * Input history hook — up/down arrow cycling through previous messages.
 */

import { useState, useCallback, useRef } from "react";
import { loadInputHistory, saveInputHistory } from "./session.js";

export interface InputHistory {
  entries: string[];
  push: (text: string) => void;
  navigateUp: (currentInput: string) => string | null;
  navigateDown: () => string | null;
  reset: () => void;
}

export function useInputHistory(maxEntries = 50): InputHistory {
  const [entries, setEntries] = useState<string[]>(() => loadInputHistory());
  const indexRef = useRef(-1); // -1 = not navigating
  const savedCurrentRef = useRef("");

  const push = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      setEntries((prev) => {
        // Deduplicate: remove if already exists
        const filtered = prev.filter((e) => e !== text);
        const next = [text, ...filtered].slice(0, maxEntries);
        saveInputHistory(next);
        return next;
      });
      indexRef.current = -1;
      savedCurrentRef.current = "";
    },
    [maxEntries],
  );

  const navigateUp = useCallback(
    (currentInput: string): string | null => {
      if (entries.length === 0) return null;

      if (indexRef.current === -1) {
        // Save current input before navigating
        savedCurrentRef.current = currentInput;
        indexRef.current = 0;
      } else if (indexRef.current < entries.length - 1) {
        indexRef.current++;
      } else {
        return null; // At the end of history
      }

      return entries[indexRef.current] ?? null;
    },
    [entries],
  );

  const navigateDown = useCallback((): string | null => {
    if (indexRef.current <= -1) return null;

    indexRef.current--;

    if (indexRef.current === -1) {
      // Return to the saved current input
      return savedCurrentRef.current;
    }

    return entries[indexRef.current] ?? null;
  }, [entries]);

  const reset = useCallback(() => {
    indexRef.current = -1;
    savedCurrentRef.current = "";
  }, []);

  return { entries, push, navigateUp, navigateDown, reset };
}
