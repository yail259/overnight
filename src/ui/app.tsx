/**
 * Main App component — three-zone layout:
 *   Zone 1: Message history (Static, native terminal scrollback)
 *   Zone 2: Status area (streaming, loading, run status — dynamic)
 *   Zone 3: Composer (toasts, status bar, shortcuts, command dropdown, input)
 *
 * Uses useReducer for state management. Toast system for ephemeral feedback.
 */

import React, { useReducer, useCallback, useEffect, useRef } from "react";
import { Box, Text, Static, useApp, useInput, useStdout } from "ink";
import type { AmbitionLevel, ProjectInfo, RunState, PendingApproval, RunMode } from "../types.js";
import type { Message, MessageContext, AppState, ToastMessage } from "./types.js";
import { appReducer, createInitialState } from "./state.js";
import { ThinkingIndicator, RunStatusBar, StatusBar, RetryCountdown } from "./status.js";
import { StreamingArea } from "./streaming.js";
import { ApprovalBar } from "./approval.js";
import { ProjectSelector } from "./project-select.js";
import { MessageLine } from "./messages.js";
import { ScrollableMessages } from "./scrollable.js";
import { TextInputBar } from "./text-input.js";
import { ToastDisplay } from "./toast.js";
import { CommandDropdown, getMatchingCommands } from "./command-dropdown.js";
import { ShortcutsBar } from "./shortcuts.js";
import { useInputHistory } from "./history.js";
import { matchCommand } from "./commands.js";
import { useTerminalWidth } from "./hooks.js";
import { TEXT, CHROME } from "./theme.js";
import type { OvernightConfig } from "../types.js";

// ── Command list for dropdown ──────────────────────────────────────

const ALL_COMMANDS = [
  { name: "clear", description: "Clear conversation" },
  { name: "compact", description: "Compress context" },
  { name: "help", description: "Show commands & keys" },
  { name: "verbose", description: "Toggle display mode" },
];

// ── App Props ───────────────────────────────────────────────────────

export interface AppProps {
  config: OvernightConfig;
  onMessage: (input: string, ctx: MessageContext) => Promise<void>;
  onAbort: () => void;
  onClear?: () => void;
  onCompact?: () => Promise<void>;
  welcomeMessages: Message[];
  projectList?: ProjectInfo[];
  onProjectsSelected?: (projects: string[]) => void;
  initialAmbition?: AmbitionLevel;
}

// ── App ─────────────────────────────────────────────────────────────

function App({
  config,
  onMessage,
  onAbort,
  onClear,
  onCompact,
  welcomeMessages,
  projectList,
  onProjectsSelected,
  initialAmbition,
}: AppProps) {
  const [state, dispatch] = useReducer(
    appReducer,
    createInitialState({
      messages: welcomeMessages,
      ambition: initialAmbition ?? "normal",
      selectingProjects: !!projectList,
    }),
  );

  const { exit } = useApp();
  const { stdout } = useStdout();
  const history = useInputHistory();
  const width = useTerminalWidth();
  const abortControllerRef = useRef<AbortController>(new AbortController());
  const processingRef = useRef(false);

  // ── Toast helper ─────────────────────────────────────────────────

  const addToast = useCallback(
    (text: string, type: "info" | "warning" | "success" = "info", durationMs = 3000) => {
      const toast: ToastMessage = {
        id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
        text,
        type,
        expiresAt: Date.now() + durationMs,
      };
      dispatch({ type: "ADD_TOAST", toast });
    },
    [],
  );

  // Expire toasts periodically
  useEffect(() => {
    const timer = setInterval(() => dispatch({ type: "EXPIRE_TOASTS" }), 1000);
    return () => clearInterval(timer);
  }, []);

  // ── Helpers ──────────────────────────────────────────────────────

  const addMessage = useCallback((msg: Message) => {
    dispatch({ type: "ADD_MESSAGE", msg });
  }, []);

  // ── Process a message (send to API) ─────────────────────────────

  const processMessage = useCallback(
    async (userText: string) => {
      dispatch({ type: "SET_LOADING", loading: true });
      processingRef.current = true;

      abortControllerRef.current = new AbortController();

      const ctx: MessageContext = {
        addMessage,
        setLoading: (loading: boolean) => dispatch({ type: "SET_LOADING", loading }),
        setStreamingText: (text: string | null) => dispatch({ type: "SET_STREAMING", text }),
        setRunState: (s: RunState | null) => dispatch({ type: "SET_RUN_STATE", state: s }),
        setPendingApproval: (a: PendingApproval | null) => dispatch({ type: "SET_APPROVAL", approval: a }),
        abortSignal: abortControllerRef.current.signal,
        ambition: state.ambition,
      };

      try {
        await onMessage(userText, ctx);
      } catch (err: any) {
        if (err.name !== "AbortError" && !abortControllerRef.current.signal.aborted) {
          addMessage({
            id: `err-${Date.now()}`,
            type: "system",
            text: `Error: ${err.message}`,
            timestamp: Date.now(),
          });
        }
      }

      dispatch({ type: "SET_STREAMING", text: null });
      dispatch({ type: "SET_LOADING", loading: false });
      processingRef.current = false;
    },
    [addMessage, onMessage, state.ambition],
  );

  // ── Queue drain effect ──────────────────────────────────────────

  useEffect(() => {
    if (!state.loading && !processingRef.current && state.inputQueue.length > 0) {
      const next = state.inputQueue[0];
      dispatch({ type: "DRAIN_QUEUE" });
      addMessage({ id: `user-${Date.now()}`, type: "user", text: next, timestamp: Date.now() });
      processMessage(next);
    }
  }, [state.loading, state.inputQueue, processMessage, addMessage]);

  // ── Handle submit ───────────────────────────────────────────────

  const handleSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();

      if (trimmed.toLowerCase() === "quit" || trimmed.toLowerCase() === "exit") {
        addToast("Goodnight!", "info");
        setTimeout(() => exit(), 300);
        return;
      }

      const cmd = matchCommand(trimmed);
      if (cmd) {
        dispatch({ type: "SET_INPUT", value: "" });
        cmd.command.handler(cmd.args, dispatch, { addMessage, onCompact, onClear });
        return;
      }

      const userText = trimmed || "What should I work on tonight?";
      dispatch({ type: "SET_INPUT", value: "" });
      history.push(userText);

      if (state.loading || processingRef.current) {
        dispatch({ type: "QUEUE_INPUT", text: userText });
        addToast(`Queued: "${userText.length > 50 ? userText.slice(0, 47) + "..." : userText}"`, "info");
      } else {
        addMessage({ id: `user-${Date.now()}`, type: "user", text: userText, timestamp: Date.now() });
        processMessage(userText);
      }
    },
    [addMessage, addToast, exit, state.loading, processMessage, history, onCompact, onClear],
  );

  // ── Handle approve/cancel ───────────────────────────────────────

  const handleApprove = useCallback((mode: RunMode) => {
    if (!state.pendingApproval) return;
    const modeLabel = mode === "stick-to-plan" ? "Stick to plan" : "Don't stop";
    dispatch({ type: "SET_APPROVAL", approval: null });
    addMessage({ id: `approve-${Date.now()}`, type: "user", text: `✓ ${modeLabel} — start the run`, timestamp: Date.now() });
    processMessage(`Approved. Start the run now in "${mode}" mode.`);
  }, [state.pendingApproval, addMessage, processMessage]);

  const handleCancel = useCallback(() => {
    dispatch({ type: "SET_APPROVAL", approval: null });
    addToast("Cancelled", "info");
    processMessage("Cancelled. Don't run it.");
  }, [addToast, processMessage]);

  // ── Global keybindings ──────────────────────────────────────────

  useInput(
    (ch, key) => {
      // Shift+Tab cycles ambition
      if (key.shift && key.tab && !state.selectingProjects) {
        dispatch({ type: "CYCLE_AMBITION" });
        addToast(`Ambition: ${["safe", "normal", "yolo"][(["safe", "normal", "yolo"].indexOf(state.ambition) + 1) % 3]}`, "info", 1500);
        return;
      }

      // Ctrl+C
      if (key.ctrl && ch === "c") {
        if (state.streamingText !== null) {
          onAbort();
          abortControllerRef.current.abort();
          addToast("Generation cancelled", "warning");
          dispatch({ type: "SET_STREAMING", text: null });
          dispatch({ type: "SET_LOADING", loading: false });
          return;
        }
        if (state.inputQueue.length > 0) {
          dispatch({ type: "CLEAR_QUEUE" });
          addToast("Queue cleared", "info");
          return;
        }
        if (Date.now() - state.ctrlCPressed < 2000) {
          exit();
          return;
        }
        dispatch({ type: "CTRL_C_PRESSED" });
        addToast(
          state.loading ? "Press Ctrl+C again to exit (task will be lost)" : "Press Ctrl+C again to exit",
          "warning",
          2000,
        );
        return;
      }

      // Ctrl+L — clear screen
      if (key.ctrl && ch === "l") {
        stdout?.write("\x1b[2J\x1b[H");
        return;
      }

      // Ctrl+V — toggle display mode
      if (key.ctrl && ch === "v") {
        dispatch({ type: "TOGGLE_DISPLAY_MODE" });
        addToast(`Display: ${state.displayMode === "compact" ? "verbose" : "compact"}`, "info", 1500);
        return;
      }

      // Escape — cancel generation or clear queue
      if (key.escape && !state.pendingApproval && !state.selectingProjects) {
        if (state.streamingText !== null) {
          onAbort();
          abortControllerRef.current.abort();
          addToast("Generation cancelled", "warning");
          dispatch({ type: "SET_STREAMING", text: null });
          dispatch({ type: "SET_LOADING", loading: false });
          return;
        }
        if (state.inputQueue.length > 0) {
          dispatch({ type: "CLEAR_QUEUE" });
          addToast("Queue cleared", "info");
          return;
        }
      }

      // Scroll mode
      if (key.shift && key.upArrow && !state.scrollMode) {
        dispatch({ type: "ENTER_SCROLL_MODE" });
        return;
      }
      if (state.scrollMode) {
        if (ch === "j" || key.downArrow) { dispatch({ type: "SCROLL", delta: 1 }); return; }
        if (ch === "k" || key.upArrow) { dispatch({ type: "SCROLL", delta: -1 }); return; }
        if (key.escape || key.return) { dispatch({ type: "EXIT_SCROLL_MODE" }); return; }
      }
    },
    { isActive: true },
  );

  // ── Handle projects selected ────────────────────────────────────

  const handleProjectsConfirmed = useCallback(
    (selected: string[]) => {
      dispatch({ type: "SET_SELECTING_PROJECTS", value: false });
      onProjectsSelected?.(selected);
      addToast(`Selected ${selected.length} projects`, "success");
    },
    [addToast, onProjectsSelected],
  );

  // ── Command dropdown state ──────────────────────────────────────

  const matchingCommands = getMatchingCommands(state.input, ALL_COMMANDS);
  const showDropdown = matchingCommands.length > 0;

  // ── Project selection phase ─────────────────────────────────────

  if (state.selectingProjects && projectList) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={TEXT.muted}>{"  " + CHROME.moon + " overnight"}</Text>
        <ProjectSelector projects={projectList} onConfirm={handleProjectsConfirmed} />
      </Box>
    );
  }

  // ── Scroll mode ─────────────────────────────────────────────────

  if (state.scrollMode) {
    return (
      <Box flexDirection="column">
        <ScrollableMessages
          messages={state.messages}
          displayMode={state.displayMode}
          scrollMode={true}
          scrollOffset={state.scrollOffset}
        />
        <ShortcutsBar
          isStreaming={false}
          isLoading={false}
          hasApproval={false}
          hasQueue={false}
          isScrollMode={true}
        />
      </Box>
    );
  }

  // ── Main three-zone layout ──────────────────────────────────────

  return (
    <>
      {/* ZONE 1: Message history — rendered once, native scrollback */}
      <Static items={state.messages}>
        {(msg) => <MessageLine key={msg.id} msg={msg} displayMode={state.displayMode} width={width} />}
      </Static>

      {/* ZONE 2: Dynamic status area */}
      <Box flexDirection="column">
        {state.streamingText !== null ? (
          <StreamingArea text={state.streamingText} />
        ) : state.loading ? (
          <ThinkingIndicator />
        ) : null}

        {state.retryState && (
          <RetryCountdown countdown={state.retryState.countdown} attempt={state.retryState.attempt} />
        )}

        {state.runState && <RunStatusBar run={state.runState} />}
      </Box>

      {/* ZONE 3: Composer — toasts, status, dropdown, input, shortcuts */}
      <Box flexDirection="column" flexShrink={0}>
        {/* Toasts */}
        <ToastDisplay toasts={state.toasts} />

        {/* Status bar */}
        <StatusBar
          model={config.model}
          ambition={state.ambition}
          queueCount={state.inputQueue.length}
        />

        {/* Command dropdown (visible when typing /) */}
        {showDropdown && (
          <CommandDropdown
            commands={ALL_COMMANDS}
            filter={state.input.slice(1)}
            activeIndex={0}
          />
        )}

        {/* Approval bar OR input */}
        {state.pendingApproval ? (
          <ApprovalBar approval={state.pendingApproval} onApprove={handleApprove} onCancel={handleCancel} />
        ) : (
          <TextInputBar
            input={state.input}
            setInput={(v) => dispatch({ type: "SET_INPUT", value: v })}
            onSubmit={handleSubmit}
            loading={state.loading}
            ambition={state.ambition}
            queueCount={state.inputQueue.length}
            history={history}
          />
        )}

        {/* Contextual shortcuts */}
        <ShortcutsBar
          isStreaming={state.streamingText !== null}
          isLoading={state.loading}
          hasApproval={!!state.pendingApproval}
          hasQueue={state.inputQueue.length > 0}
          isScrollMode={false}
        />
      </Box>
    </>
  );
}

export default App;
