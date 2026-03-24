/**
 * UI-specific types for the overnight TUI.
 */

import type { AmbitionLevel, RunState, PendingApproval } from "../types.js";

export interface Message {
  id: string;
  type: "user" | "assistant" | "system" | "tool";
  text: string;
  timestamp: number;
}

export interface SessionData {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  apiMessages: any[]; // Anthropic.MessageParam[]
  ambition: AmbitionLevel;
}

export interface InputHistoryEntry {
  text: string;
  timestamp: number;
}

export type DisplayMode = "compact" | "verbose";

export interface ToastMessage {
  id: string;
  text: string;
  type: "info" | "warning" | "success";
  expiresAt: number;
}

export interface AppState {
  messages: Message[];
  input: string;
  loading: boolean;
  streamingText: string | null;
  runState: RunState | null;
  pendingApproval: PendingApproval | null;
  ambition: AmbitionLevel;
  selectingProjects: boolean;
  inputQueue: string[];
  displayMode: DisplayMode;
  scrollMode: boolean;
  scrollOffset: number;
  retryState: { countdown: number; attempt: number } | null;
  ctrlCPressed: number;
  sessionId: string;
  toasts: ToastMessage[];
}

export type AppAction =
  | { type: "ADD_MESSAGE"; msg: Message }
  | { type: "SET_INPUT"; value: string }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_STREAMING"; text: string | null }
  | { type: "SET_RUN_STATE"; state: RunState | null }
  | { type: "SET_APPROVAL"; approval: PendingApproval | null }
  | { type: "SET_AMBITION"; ambition: AmbitionLevel }
  | { type: "CYCLE_AMBITION" }
  | { type: "QUEUE_INPUT"; text: string }
  | { type: "DRAIN_QUEUE" }
  | { type: "CLEAR_QUEUE" }
  | { type: "CLEAR_MESSAGES" }
  | { type: "TOGGLE_DISPLAY_MODE" }
  | { type: "ENTER_SCROLL_MODE" }
  | { type: "EXIT_SCROLL_MODE" }
  | { type: "SCROLL"; delta: number }
  | { type: "SET_RETRY"; state: { countdown: number; attempt: number } | null }
  | { type: "SET_SELECTING_PROJECTS"; value: boolean }
  | { type: "CTRL_C_PRESSED" }
  | { type: "ADD_TOAST"; toast: ToastMessage }
  | { type: "EXPIRE_TOASTS" };

/** Context passed to onMessage handler */
export interface MessageContext {
  addMessage: (msg: Message) => void;
  setLoading: (loading: boolean) => void;
  setStreamingText: (text: string | null) => void;
  setRunState: (state: RunState | null) => void;
  setPendingApproval: (approval: PendingApproval | null) => void;
  abortSignal: AbortSignal;
  ambition: AmbitionLevel;
}
