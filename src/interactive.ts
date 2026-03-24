/**
 * Interactive mode — chat-based front door to overnight.
 * Uses Anthropic SDK streaming + React Ink TUI.
 *
 * CWD-scoped by default. --all for cross-project with project multi-select.
 * Adaptive prediction: predict one → execute → observe → predict next.
 *
 * Features: abort (#3), retry (#17/#18),
 * session persistence (#13), compact (#15).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream.js";
import { createInterface } from "readline";
import type { OvernightConfig, OvernightRun, AmbitionLevel, RunState, PendingApproval, RunMode } from "./types.js";
import { RUNS_DIR, PID_FILE, CONFIG_FILE, OVERNIGHT_DIR } from "./types.js";
import { predictMessages, suggestPlans } from "./predictor.js";
import { executeAll, getLatestRun } from "./executor.js";
import { getAllMessages, getMessagesForCwd, getProjectList } from "./history.js";
import { loadProfile, updateProfile, profileToPromptContext } from "./profile.js";
import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync, readdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { renderApp, type Message, type MessageContext } from "./ui/index.js";
import { withRetry } from "./ui/retry.js";
import { saveSession, createSessionData, getLatestSession } from "./ui/session.js";

// ── Tool schemas ─────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: "suggest_plans",
    description: "Analyze recent CC activity and suggest overnight plans. Call at start or when user asks what to work on.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "preview_run",
    description: "Preview high-level goals for a run WITHOUT executing. ALWAYS call before start_run. Returns goals the adaptive loop will pursue.",
    input_schema: {
      type: "object" as const,
      properties: {
        intent: { type: "string", description: "What to accomplish" },
        cwd: { type: "string", description: "Working directory" },
      },
      required: ["intent", "cwd"],
    },
  },
  {
    name: "start_run",
    description: "Start an adaptive run. ONLY after preview_run AND user selects a mode. The run predicts messages one at a time, observing results between each.",
    input_schema: {
      type: "object" as const,
      properties: {
        intent: { type: "string" },
        cwd: { type: "string" },
        mode: { type: "string", enum: ["stick-to-plan", "dont-stop"], description: "Run mode selected by user" },
      },
      required: ["intent", "cwd", "mode"],
    },
  },
  {
    name: "show_log",
    description: "Show run results.",
    input_schema: {
      type: "object" as const,
      properties: { all: { type: "boolean" } },
      required: [],
    },
  },
  {
    name: "show_history",
    description: "Show recent Claude Code message history.",
    input_schema: {
      type: "object" as const,
      properties: {
        cwd: { type: "string" },
        limit: { type: "number" },
      },
      required: [],
    },
  },
  {
    name: "stop_run",
    description: "Stop a running session.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "show_profile",
    description: "Show user profile.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
];

// ── Tool context ─────────────────────────────────────────────────────

interface ToolContext {
  config: OvernightConfig;
  ambition: AmbitionLevel;
  scopedCwd: string | undefined;
  selectedProjects: string[] | undefined;
  addMessage: (msg: Message) => void;
  setRunState: (state: RunState | null) => void;
  setPendingApproval: (approval: PendingApproval | null) => void;
}

// ── Tool handlers ────────────────────────────────────────────────────

async function handleTool(name: string, input: any, ctx: ToolContext): Promise<string> {
  const { config, ambition, scopedCwd, selectedProjects, addMessage, setRunState, setPendingApproval } = ctx;

  switch (name) {
    case "suggest_plans": {
      const plans = await suggestPlans(config, {
        cwd: scopedCwd,
        projects: selectedProjects,
        ambition,
      });
      if (plans.length === 0) return "No conversation history found.";
      return plans
        .map(
          (p, i) =>
            `${i + 1}. "${p.intent}" (${p.project}, ~${p.estimatedMessages} msgs)\n   ${p.description}`,
        )
        .join("\n\n");
    }

    case "preview_run": {
      const predictions = await predictMessages(input.intent, input.cwd, config, ambition);
      if (predictions.length === 0) return "No messages predicted.";

      const goals = predictions.map((p) => p.message);

      let r = `Goals for "${input.intent}" (~${predictions.length} steps):\n\n`;
      for (let i = 0; i < predictions.length; i++) {
        const p = predictions[i];
        r += `${i + 1}. ${p.message}\n   ${p.reasoning}\n\n`;
      }
      r += `All work happens on a single branch (overnight/*). Adaptive — each step observes previous results.`;

      setPendingApproval({
        intent: input.intent,
        cwd: input.cwd,
        goals,
      });

      return r;
    }

    case "start_run": {
      const mode: RunMode = input.mode ?? "stick-to-plan";
      const startTime = Date.now();

      setRunState({
        status: "starting",
        runId: "",
        total: 0,
        current: 0,
        passed: 0,
        failed: 0,
        elapsed: 0,
        startedAt: startTime,
        mode,
      });

      addMessage({ id: `run-predict-${startTime}`, type: "system", text: "Predicting first step...", timestamp: Date.now() });

      // Get initial predictions for goals
      const predictions = await predictMessages(input.intent, input.cwd, config, ambition);
      if (predictions.length === 0) {
        setRunState(null);
        return "No messages predicted.";
      }

      const runId = `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}-${Math.random().toString(36).slice(2, 6)}`;
      let baseBranch = "main";
      try {
        baseBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: input.cwd, stdio: "pipe" })
          .toString()
          .trim();
      } catch {}

      const branchName = `overnight/${runId}`;

      const run: OvernightRun = {
        id: runId,
        intent: input.intent,
        startedAt: new Date().toISOString(),
        cwd: input.cwd,
        baseBranch,
        branch: branchName,
        mode,
        predictions: [predictions[0]], // start with first prediction
        results: [],
        status: "running",
      };

      mkdirSync(RUNS_DIR, { recursive: true });
      writeFileSync(join(RUNS_DIR, `${runId}.json`), JSON.stringify(run, null, 2));
      writeFileSync(PID_FILE, String(process.pid));

      const modeLabel = mode === "stick-to-plan" ? "Stick to plan" : "Don't stop";

      setRunState({
        status: "running",
        runId,
        total: predictions.length,
        current: 0,
        currentMessage: predictions[0]?.message,
        passed: 0,
        failed: 0,
        elapsed: 0,
        startedAt: startTime,
        mode,
      });

      addMessage({
        id: `run-start-${runId}`,
        type: "system",
        text: `Run started: ${modeLabel} mode (${runId})`,
        timestamp: Date.now(),
      });

      let passed = 0;
      let failed = 0;

      await executeAll(run, config, {
        onStart: (prediction, index) => {
          setRunState({
            status: "running",
            runId,
            total: run.predictions.length,
            current: index,
            currentMessage: prediction.message,
            passed,
            failed,
            elapsed: Math.round((Date.now() - startTime) / 1000),
            startedAt: startTime,
            mode,
          });
        },
        onProgress: (result, index) => {
          const ok = result.exitCode === 0;
          if (ok) passed++;
          else failed++;

          const icon = ok ? "✓" : "✗";
          addMessage({
            id: `run-${runId}-${index}`,
            type: "system",
            text: `${icon} Step ${index + 1}: ${result.message.slice(0, 60)}`,
            timestamp: Date.now(),
          });

          setRunState({
            status: "running",
            runId,
            total: run.predictions.length,
            current: index + 1,
            passed,
            failed,
            elapsed: Math.round((Date.now() - startTime) / 1000),
            startedAt: startTime,
            mode,
          });
        },
        onPrediction: (prediction, reasoning, index) => {
          if (prediction) {
            addMessage({
              id: `run-predict-${runId}-${index}`,
              type: "system",
              text: `→ Next: ${prediction.message.slice(0, 70)}`,
              timestamp: Date.now(),
            });
          } else {
            addMessage({
              id: `run-done-${runId}`,
              type: "system",
              text: `→ Done: ${reasoning}`,
              timestamp: Date.now(),
            });
          }
        },
      });

      try {
        unlinkSync(PID_FILE);
      } catch {}

      const finalStatus = run.status === "failed" ? "failed" : run.status === "stopped" ? "stopped" : "completed";

      setRunState({
        status: finalStatus as RunState["status"],
        runId,
        total: run.results.length,
        current: run.results.length,
        passed,
        failed,
        elapsed: Math.round((Date.now() - startTime) / 1000),
        startedAt: startTime,
        mode,
      });

      let result = `Done: ${passed}/${run.results.length} steps succeeded`;
      if (finalStatus === "failed") result += " (stopped early due to failure)";
      if (finalStatus === "stopped") result += " (stopped by user)";
      result += `\nBranch: ${run.branch}`;
      result += "\nRun `overnight log` in the morning to review.";
      return result;
    }

    case "show_log": {
      if (!existsSync(RUNS_DIR)) return "No runs yet.";
      if (input.all) {
        const files = readdirSync(RUNS_DIR)
          .filter((f) => f.endsWith(".json"))
          .sort()
          .reverse();
        if (files.length === 0) return "No runs found.";
        return files
          .map((f) => {
            const run = JSON.parse(readFileSync(join(RUNS_DIR, f), "utf-8")) as OvernightRun;
            const p = run.results.filter((r) => r.exitCode === 0).length;
            return `${run.id}  ${run.status}  ${p}/${run.results.length} ok  "${run.intent.slice(0, 50)}"`;
          })
          .join("\n");
      }
      const run = getLatestRun();
      if (!run) return "No runs found.";
      let result = `Run: ${run.id}\nStatus: ${run.status}\nMode: ${run.mode}\nBranch: ${run.branch}\nIntent: "${run.intent}"\n`;
      for (const r of run.results)
        result += `${r.exitCode === 0 ? "ok" : "fail"} ${r.message}\n  branch: ${r.branch}\n`;
      return result;
    }

    case "show_history": {
      const n = input.limit ?? 20;
      const msgs = input.cwd
        ? getMessagesForCwd(input.cwd, n * 500)
        : getAllMessages({ tokenBudget: n * 500 });
      if (msgs.length === 0) return "No message history found.";
      return msgs
        .slice(0, n)
        .map(
          (m) =>
            `[${m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : "?"}] (${m.project}) ${m.text.slice(0, 100)}`,
        )
        .join("\n");
    }

    case "stop_run": {
      if (!existsSync(PID_FILE)) return "No session running.";
      const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
      const latest = getLatestRun();
      if (latest?.status === "running") {
        latest.status = "stopped";
        writeFileSync(join(RUNS_DIR, `${latest.id}.json`), JSON.stringify(latest, null, 2));
      }
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
      try {
        unlinkSync(PID_FILE);
      } catch {}
      setRunState(null);
      return `Stopped (pid ${pid}).`;
    }

    case "show_profile": {
      const profile = loadProfile();
      if (!profile.updatedAt) return "No profile yet. It builds automatically.";
      return profileToPromptContext(profile);
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

// ── First-run setup ──────────────────────────────────────────────────

async function setupApiKey(config: OvernightConfig): Promise<OvernightConfig> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, resolve));

  console.log("\n  overnight — another you for when you're asleep\n");
  console.log("  Needs an API key to get started.");
  console.log("  Works with Anthropic and any compatible API (GLM, Minimax, Kimi, etc.)");
  console.log("  Get an Anthropic key at: https://console.anthropic.com/settings/keys\n");

  const key = await ask("  API key: ");
  if (key.trim()) config.apiKey = key.trim();

  const url = await ask("  Custom API base URL (blank for Anthropic default): ");
  if (url.trim()) config.baseUrl = url.trim();

  mkdirSync(OVERNIGHT_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

  if (!config.apiKey && !process.env.ANTHROPIC_API_KEY) {
    console.log("\n  No key provided. Set one later:");
    console.log("    overnight config --set apiKey=your-key");
    console.log("    overnight config --set baseUrl=https://api.example.com\n");
    rl.close();
    return config;
  }

  console.log("\n  Building your profile from Claude Code history...");
  try {
    const profile = await updateProfile(config);
    console.log(`  Analyzed ${profile.turnsAnalyzed} conversation turns. Ready to go!\n`);
  } catch {
    console.log("  Skipped — profile will build up over time.\n");
  }

  rl.close();
  return config;
}

// ── Main interactive loop ────────────────────────────────────────────

export interface InteractiveOptions {
  all?: boolean;
  resume?: boolean;
}

export async function runInteractive(config: OvernightConfig, opts: InteractiveOptions = {}): Promise<void> {
  const hasKey = config.apiKey || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
  if (!hasKey) {
    config = await setupApiKey(config);
  }
  if (!config.apiKey && !process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    process.exit(0);
  }

  const client = new Anthropic({
    apiKey: config.apiKey || undefined,
    baseURL: config.baseUrl || undefined,
  });

  // Auto-refresh stale profile
  const profile = loadProfile();
  const profileAge = profile.updatedAt ? Date.now() - new Date(profile.updatedAt).getTime() : Infinity;
  if (profileAge > 24 * 60 * 60 * 1000) {
    const isFirstTime = !profile.updatedAt;
    if (isFirstTime) {
      console.log("\n  ☽ First time? overnight is building a profile of how you code.");
      console.log("  This takes ~30s — feel free to grab a coffee.\n");
      process.stdout.write("  Scanning Claude Code sessions... ");
    } else {
      process.stdout.write("  ☽ Refreshing your profile... ");
    }
    try {
      await updateProfile(config);
      if (isFirstTime) {
        console.log("done!");
        const fresh = loadProfile();
        if (fresh.communicationStyle.tone) {
          console.log(`  Style: ${fresh.communicationStyle.tone}`);
        }
        if (fresh.values.length > 0) {
          console.log(`  Values: ${fresh.values.slice(0, 4).join(", ")}`);
        }
        console.log("");
      } else {
        console.log("done.\n");
      }
    } catch (err: any) {
      console.log(isFirstTime ? "skipped (no sessions found).\n" : "skipped.\n");
    }
  }

  const freshProfile = loadProfile();
  const profileContext = profileToPromptContext(freshProfile);

  const cwd = process.cwd();
  const isAllMode = !!opts.all;
  const projectList = isAllMode ? getProjectList() : undefined;
  let scopedCwd: string | undefined = isAllMode ? undefined : cwd;
  let selectedProjects: string[] | undefined = undefined;

  // Resume previous session if requested
  let resumedSession = opts.resume ? getLatestSession() : null;

  const scopeDescription = isAllMode
    ? "Cross-project mode — user selected specific projects."
    : `Scoped to: ${cwd}`;

  const systemPrompt = `You are overnight — another you for when you're asleep. You help developers set up adaptive Claude Code work while they sleep.

## How overnight works
overnight predicts what the user would type next in Claude Code, then types it for them. Each prediction observes the results of the previous one — output, diffs, test results — and adapts.

## Workflow — ALWAYS follow this order:
1. **Greet + suggest**: Call suggest_plans to show 2-4 options from their recent activity.
2. **Preview before execute**: ALWAYS call preview_run first. This shows high-level goals, not literal messages.
3. **Mode selection is handled by the UI**: After preview_run, the UI shows "Stick to plan" and "Don't stop" buttons. Do NOT ask the user to choose — the UI handles it. Just describe what the plan does.
4. **When user approves with a mode**: Call start_run with the selected mode immediately.
5. **Report**: Summarize results, mention the branch for morning review.

## Run modes
- **Stick to plan**: One sprint. Accomplish the goals, then stop.
- **Don't stop**: Continuous sprints. After primary goals, move to docs, tests, cleanup. Runs until nothing left or user Ctrl+C.

## Scope
${scopeDescription}

## Safety: all work happens on a single branch (overnight/*), main untouched.

## Run status: The user can see a live status bar showing run progress. Don't repeat what it shows — focus on high-level commentary.

## Ambition: the user can toggle ambition level (shown in their input bar).

## Style: conversational, concise, match user's style from profile.

${profileContext ? `\n## User Profile\n${profileContext}\n` : ""}
Working directory: ${cwd}`;

  // Restore or initialize API messages
  const messages: Anthropic.MessageParam[] = resumedSession?.apiMessages ?? [];
  const sessionId = resumedSession?.id ?? `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // Active stream reference for abort support
  let currentStream: MessageStream | null = null;

  const welcomeMessages: Message[] = resumedSession
    ? [
        ...resumedSession.messages,
        {
          id: `sys-resume-${Date.now()}`,
          type: "system" as const,
          text: "Session resumed.",
          timestamp: Date.now(),
        },
      ]
    : [
        {
          id: "w1",
          type: "system" as const,
          text: "overnight — another you for when you're asleep",
          timestamp: Date.now(),
        },
        {
          id: "w2",
          type: "system" as const,
          text: isAllMode
            ? "Select projects to include, then we'll get started."
            : "Press enter for suggestions, or describe what you want. Shift+Tab to change ambition. /help for commands. Type 'quit' to exit.",
          timestamp: Date.now(),
        },
      ];

  // ── Message handler (new signature with MessageContext) ─────────────

  const handleUserMessage = async (userText: string, ctx: MessageContext) => {
    const { addMessage, setLoading, setStreamingText, setRunState, setPendingApproval, abortSignal, ambition } = ctx;

    const augmentedText = `[ambition: ${ambition}] ${userText}`;
    messages.push({ role: "user", content: augmentedText });

    const toolCtx: ToolContext = {
      config,
      ambition,
      scopedCwd,
      selectedProjects,
      addMessage,
      setRunState,
      setPendingApproval,
    };

    const streamResponse = async (): Promise<Anthropic.Message> => {
      let streamedText = "";
      setStreamingText("");

      // Wrap in retry for resilience
      const response = await withRetry(
        async () => {
          // Check abort before starting
          if (abortSignal.aborted) throw new DOMException("Aborted", "AbortError");

          streamedText = "";
          setStreamingText("");

          const stream = client.messages.stream({
            model: config.model,
            max_tokens: 4096,
            system: systemPrompt,
            tools: TOOLS,
            messages,
          });

          currentStream = stream;

          // Abort handler
          const onAbort = () => {
            try { stream.abort(); } catch {}
          };
          abortSignal.addEventListener("abort", onAbort, { once: true });

          stream.on("text", (text) => {
            streamedText += text;
            setStreamingText(streamedText);
          });

          try {
            const msg = await stream.finalMessage();
            abortSignal.removeEventListener("abort", onAbort);
            currentStream = null;
            return msg;
          } catch (err: any) {
            abortSignal.removeEventListener("abort", onAbort);
            currentStream = null;
            throw err;
          }
        },
        {
          maxRetries: 3,
          onRetry: (attempt, delayMs, error) => {
            addMessage({
              id: `retry-${Date.now()}`,
              type: "system",
              text: `Retrying (attempt ${attempt}, ${Math.round(delayMs / 1000)}s)... ${error.message?.slice(0, 60) ?? ""}`,
              timestamp: Date.now(),
            });
          },
          onRateLimit: (retryAfterMs) => {
            addMessage({
              id: `ratelimit-${Date.now()}`,
              type: "system",
              text: `Rate limited. Waiting ${Math.round(retryAfterMs / 1000)}s...`,
              timestamp: Date.now(),
            });
          },
        },
      );

      if (streamedText.trim()) {
        setStreamingText(null);
        addMessage({
          id: `a-${Date.now()}-${Math.random()}`,
          type: "assistant",
          text: streamedText,
          timestamp: Date.now(),
        });
      } else {
        setStreamingText(null);
      }

      return response;
    };

    let response = await streamResponse();

    while (response.stop_reason === "tool_use") {
      // Check abort
      if (abortSignal.aborted) break;

      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type === "tool_use") {
          if (abortSignal.aborted) break;
          addMessage({ id: `t-${block.id}`, type: "tool", text: block.name, timestamp: Date.now() });
          setLoading(true);
          const result = await handleTool(block.name, block.input, toolCtx);
          addMessage({ id: `td-${block.id}`, type: "tool", text: `${block.name} done`, timestamp: Date.now() });
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
        }
      }

      if (abortSignal.aborted) break;

      messages.push({ role: "user", content: toolResults });
      response = await streamResponse();
    }

    if (!abortSignal.aborted) {
      messages.push({ role: "assistant", content: response.content });
    }

    // Auto-save session
    try {
      saveSession(createSessionData(sessionId, [], messages, ambition));
    } catch {}
  };

  // ── Abort handler ──────────────────────────────────────────────────

  const handleAbort = () => {
    if (currentStream) {
      try { currentStream.abort(); } catch {}
      currentStream = null;
    }
  };

  // ── Clear handler (for /clear command) ─────────────────────────────

  const handleClear = () => {
    messages.length = 0; // Clear API message history
  };

  // ── Compact handler (for /compact command) ─────────────────────────

  const handleCompact = async () => {
    if (messages.length < 4) return;

    // Summarize conversation
    try {
      const summaryResponse = await client.messages.create({
        model: config.model,
        max_tokens: 1024,
        system: "Summarize this conversation concisely, preserving key decisions, context, and any planned actions. Output only the summary.",
        messages: [
          {
            role: "user",
            content: messages
              .map((m) => {
                if (typeof m.content === "string") return `${m.role}: ${m.content}`;
                return `${m.role}: [structured content]`;
              })
              .join("\n"),
          },
        ],
      });

      const summary =
        summaryResponse.content[0]?.type === "text" ? summaryResponse.content[0].text : "Conversation summary unavailable.";

      // Replace messages with summary
      messages.length = 0;
      messages.push({
        role: "user",
        content: `[Previous conversation summary: ${summary}]\n\nContinuing from where we left off.`,
      });
    } catch (err: any) {
      // Don't throw — just log
    }
  };

  // ── Project selection ──────────────────────────────────────────────

  const handleProjectsSelected = (projects: string[]) => {
    selectedProjects = projects;
    scopedCwd = undefined;
  };

  // ── Launch TUI ─────────────────────────────────────────────────────

  renderApp(config, handleUserMessage, handleAbort, welcomeMessages, {
    projectList,
    onProjectsSelected: handleProjectsSelected,
    onClear: handleClear,
    onCompact: handleCompact,
  });
}
