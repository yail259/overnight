/**
 * Main App component — orchestrates all TUI state and components.
 * Uses useReducer for state management.
 * Implements: input queuing (#2), cancel (#3), Ctrl+C (#16), Ctrl+L (#23),
 *   Escape clear queue (#7), scroll mode (#20), display mode toggle (#27).
 */

import React, { useReducer, useCallback, useEffect, useRef } from "react";
import { Box, Text, Static, useApp, useInput, useStdout } from "ink";
import type { AmbitionLevel, ProjectInfo, RunState, PendingApproval, RunMode } from "../types.js";
import type { Message, MessageContext, AppState } from "./types.js";
import { appReducer, createInitialState } from "./state.js";
import { ThinkingIndicator, RunStatusBar, StatusBar, RetryCountdown } from "./status.js";
import { StreamingArea } from "./streaming.js";
import { ApprovalBar } from "./approval.js";
import { ProjectSelector } from "./project-select.js";
import { MessageLine } from "./messages.js";
import { InputBar } from "./input.js";
import { useInputHistory } from "./history.js";
import { matchCommand } from "./commands.js";
import { useTerminalWidth } from "./hooks.js";
import { TEXT } from "./theme.js";
import type { OvernightConfig } from "../types.js";

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

  // ── Helpers ────────────────────────────────────────────────────────

  const addMessage = useCallback((msg: Message) => {
    dispatch({ type: "ADD_MESSAGE", msg });
  }, []);

  // ── Process a message (send to API) ────────────────────────────────

  const processMessage = useCallback(
    async (userText: string) => {
      dispatch({ type: "SET_LOADING", loading: true });
      processingRef.current = true;

      // Fresh abort controller for this message
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

  // ── Queue drain effect ─────────────────────────────────────────────

  useEffect(() => {
    if (!state.loading && !processingRef.current && state.inputQueue.length > 0) {
      const next = state.inputQueue[0];
      dispatch({ type: "DRAIN_QUEUE" });
      addMessage({ id: `user-${Date.now()}`, type: "user", text: next, timestamp: Date.now() });
      processMessage(next);
    }
  }, [state.loading, state.inputQueue, processMessage, addMessage]);

  // ── Handle submit ──────────────────────────────────────────────────

  const handleSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();

      // Exit commands — always immediate
      if (trimmed.toLowerCase() === "quit" || trimmed.toLowerCase() === "exit") {
        addMessage({ id: `sys-${Date.now()}`, type: "system", text: "Goodnight!", timestamp: Date.now() });
        setTimeout(() => exit(), 100);
        return;
      }

      // Slash commands
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
        // Queue the message
        dispatch({ type: "QUEUE_INPUT", text: userText });
        addMessage({
          id: `queued-${Date.now()}`,
          type: "system",
          text: `Queued: "${userText.length > 60 ? userText.slice(0, 57) + "..." : userText}"`,
          timestamp: Date.now(),
        });
      } else {
        // Process immediately
        addMessage({ id: `user-${Date.now()}`, type: "user", text: userText, timestamp: Date.now() });
        processMessage(userText);
      }
    },
    [addMessage, exit, state.loading, processMessage, history, onCompact, onClear],
  );

  // ── Handle approve/cancel ──────────────────────────────────────────

  const handleApprove = useCallback((mode: RunMode) => {
    if (!state.pendingApproval) return;
    const modeLabel = mode === "stick-to-plan" ? "Stick to plan" : "Don't stop";
    dispatch({ type: "SET_APPROVAL", approval: null });
    addMessage({ id: `approve-${Date.now()}`, type: "user", text: `✓ ${modeLabel} — start the run`, timestamp: Date.now() });
    processMessage(`Approved. Start the run now in "${mode}" mode.`);
  }, [state.pendingApproval, addMessage, processMessage]);

  const handleCancel = useCallback(() => {
    dispatch({ type: "SET_APPROVAL", approval: null });
    addMessage({ id: `cancel-${Date.now()}`, type: "user", text: "✗ Cancelled", timestamp: Date.now() });
    processMessage("Cancelled. Don't run it.");
  }, [addMessage, processMessage]);

  // ── Global keybindings ─────────────────────────────────────────────

  useInput(
    (ch, key) => {
      // Shift+Tab cycles ambition (always responsive)
      if (key.shift && key.tab && !state.selectingProjects) {
        dispatch({ type: "CYCLE_AMBITION" });
        return;
      }

      // Ctrl+C — exit with double-press protection
      if (key.ctrl && ch === "c") {
        // If streaming, abort first
        if (state.streamingText !== null) {
          onAbort();
          abortControllerRef.current.abort();
          addMessage({ id: `abort-${Date.now()}`, type: "system", text: "Generation cancelled.", timestamp: Date.now() });
          dispatch({ type: "SET_STREAMING", text: null });
          dispatch({ type: "SET_LOADING", loading: false });
          return;
        }
        // If queue, clear it
        if (state.inputQueue.length > 0) {
          dispatch({ type: "CLEAR_QUEUE" });
          addMessage({ id: `sys-${Date.now()}`, type: "system", text: "Queue cleared.", timestamp: Date.now() });
          return;
        }
        // Double-press to exit
        if (Date.now() - state.ctrlCPressed < 2000) {
          exit();
          return;
        }
        dispatch({ type: "CTRL_C_PRESSED" });
        addMessage({
          id: `sys-${Date.now()}`,
          type: "system",
          text: state.loading ? "Press Ctrl+C again to exit (current task will be lost)." : "Press Ctrl+C again to exit.",
          timestamp: Date.now(),
        });
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
        return;
      }

      // Escape — cancel generation or clear queue
      if (key.escape && !state.pendingApproval && !state.selectingProjects) {
        if (state.streamingText !== null) {
          onAbort();
          abortControllerRef.current.abort();
          addMessage({ id: `abort-${Date.now()}`, type: "system", text: "Generation cancelled.", timestamp: Date.now() });
          dispatch({ type: "SET_STREAMING", text: null });
          dispatch({ type: "SET_LOADING", loading: false });
          return;
        }
        if (state.inputQueue.length > 0) {
          dispatch({ type: "CLEAR_QUEUE" });
          addMessage({ id: `sys-${Date.now()}`, type: "system", text: "Queue cleared.", timestamp: Date.now() });
          return;
        }
      }

      // Scroll mode: Shift+Up/Down to enter, j/k to scroll, Esc to exit
      if (key.shift && key.upArrow && !state.scrollMode) {
        dispatch({ type: "ENTER_SCROLL_MODE" });
        return;
      }
      if (state.scrollMode) {
        if (ch === "j" || key.downArrow) {
          dispatch({ type: "SCROLL", delta: 1 });
          return;
        }
        if (ch === "k" || key.upArrow) {
          dispatch({ type: "SCROLL", delta: -1 });
          return;
        }
        if (key.escape || key.return) {
          dispatch({ type: "EXIT_SCROLL_MODE" });
          return;
        }
      }
    },
    { isActive: true },
  );

  // ── Handle projects selected ───────────────────────────────────────

  const handleProjectsConfirmed = useCallback(
    (selected: string[]) => {
      dispatch({ type: "SET_SELECTING_PROJECTS", value: false });
      onProjectsSelected?.(selected);
      addMessage({
        id: `sys-proj-${Date.now()}`,
        type: "system",
        text: `Selected ${selected.length} projects: ${selected.join(", ")}`,
        timestamp: Date.now(),
      });
    },
    [addMessage, onProjectsSelected],
  );

  // ── Project selection phase ────────────────────────────────────────

  if (state.selectingProjects && projectList) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={TEXT.muted}>{"  overnight"}</Text>
        <ProjectSelector projects={projectList} onConfirm={handleProjectsConfirmed} />
      </Box>
    );
  }

  // ── Scroll mode view ───────────────────────────────────────────────

  if (state.scrollMode) {
    const rows = stdout?.rows ?? 24;
    const viewportSize = Math.max(5, rows - 6);
    const start = Math.max(0, state.messages.length - viewportSize - state.scrollOffset);
    const end = Math.min(state.messages.length, start + viewportSize);
    const visible = state.messages.slice(start, end);

    return (
      <Box flexDirection="column">
        {visible.map((msg) => (
          <MessageLine key={msg.id} msg={msg} displayMode={state.displayMode} width={width} />
        ))}
        <Box marginLeft={2}>
          <Text color={TEXT.muted}>
            {"↑↓ scroll · Esc exit · "}
            {`${start + 1}–${end} of ${state.messages.length}`}
          </Text>
        </Box>
      </Box>
    );
  }

  // ── Main view ──────────────────────────────────────────────────────

  return (
    <>
      {/* Static message history — rendered once, native terminal scrollback */}
      <Static items={state.messages}>
        {(msg) => <MessageLine key={msg.id} msg={msg} displayMode={state.displayMode} width={width} />}
      </Static>

      {/* Dynamic footer — only this portion re-renders */}
      <Box flexDirection="column">
        {/* Streaming text or loading spinner */}
        {state.streamingText !== null ? (
          <StreamingArea text={state.streamingText} />
        ) : state.loading ? (
          <ThinkingIndicator />
        ) : null}

        {/* Retry countdown */}
        {state.retryState && <RetryCountdown countdown={state.retryState.countdown} attempt={state.retryState.attempt} />}

        {/* Run status bar with progress */}
        {state.runState && <RunStatusBar run={state.runState} />}

        {/* Status bar (model, ambition) */}
        <StatusBar
          model={config.model}
          ambition={state.ambition}
          queueCount={state.inputQueue.length}
        />

        {/* Approval bar OR input bar */}
        {state.pendingApproval ? (
          <ApprovalBar approval={state.pendingApproval} onApprove={handleApprove} onCancel={handleCancel} />
        ) : (
          <InputBar
            input={state.input}
            setInput={(v) => dispatch({ type: "SET_INPUT", value: v })}
            onSubmit={handleSubmit}
            loading={state.loading}
            ambition={state.ambition}
            queueCount={state.inputQueue.length}
            history={history}
          />
        )}
      </Box>
    </>
  );
}

export default App;
