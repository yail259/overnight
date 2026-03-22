/**
 * useReducer-based state management for the overnight TUI.
 */

import { AMBITION_LEVELS } from "../types.js";
import type { AppState, AppAction } from "./types.js";

export function createInitialState(overrides?: Partial<AppState>): AppState {
  return {
    messages: [],
    input: "",
    loading: false,
    streamingText: null,
    runState: null,
    pendingApproval: null,
    ambition: "normal",
    selectingProjects: false,
    inputQueue: [],
    displayMode: "verbose",
    scrollMode: false,
    scrollOffset: 0,
    retryState: null,
    ctrlCPressed: 0,
    sessionId: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ...overrides,
  };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.msg] };

    case "SET_INPUT":
      return { ...state, input: action.value };

    case "SET_LOADING":
      return { ...state, loading: action.loading };

    case "SET_STREAMING":
      return { ...state, streamingText: action.text };

    case "SET_RUN_STATE":
      return { ...state, runState: action.state };

    case "SET_APPROVAL":
      return { ...state, pendingApproval: action.approval };

    case "SET_AMBITION":
      return { ...state, ambition: action.ambition };

    case "CYCLE_AMBITION": {
      const idx = AMBITION_LEVELS.indexOf(state.ambition);
      return { ...state, ambition: AMBITION_LEVELS[(idx + 1) % AMBITION_LEVELS.length] };
    }

    case "QUEUE_INPUT":
      return { ...state, inputQueue: [...state.inputQueue, action.text] };

    case "DRAIN_QUEUE": {
      if (state.inputQueue.length === 0) return state;
      return { ...state, inputQueue: state.inputQueue.slice(1) };
    }

    case "CLEAR_QUEUE":
      return { ...state, inputQueue: [] };

    case "CLEAR_MESSAGES":
      return { ...state, messages: [] };

    case "TOGGLE_DISPLAY_MODE":
      return { ...state, displayMode: state.displayMode === "compact" ? "verbose" : "compact" };

    case "ENTER_SCROLL_MODE":
      return { ...state, scrollMode: true, scrollOffset: 0 };

    case "EXIT_SCROLL_MODE":
      return { ...state, scrollMode: false, scrollOffset: 0 };

    case "SCROLL":
      return {
        ...state,
        scrollOffset: Math.max(0, Math.min(state.messages.length - 1, state.scrollOffset + action.delta)),
      };

    case "SET_RETRY":
      return { ...state, retryState: action.state };

    case "SET_SELECTING_PROJECTS":
      return { ...state, selectingProjects: action.value };

    case "CTRL_C_PRESSED":
      return { ...state, ctrlCPressed: Date.now() };

    default:
      return state;
  }
}
