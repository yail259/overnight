import { query, type Options as ClaudeCodeOptions } from "@anthropic-ai/claude-agent-sdk";
import type { AgentConfig, AgentLoopState, TradeDecision } from "../types.js";
import { findClaudeExecutable } from "../runner.js";
import { createAlpacaMcpServer } from "./mcp.js";
import { buildSystemPrompt, buildLoopPrompt } from "./prompts.js";
import { loadAgentState, saveAgentState, appendDecision, resetDailyPnlIfNewDay } from "./state.js";
import { createGuardrailHooks } from "./guardrails.js";

const ALPACA_MCP_TOOLS = [
  "mcp__alpaca__get_account",
  "mcp__alpaca__get_positions",
  "mcp__alpaca__get_market_clock",
  "mcp__alpaca__get_bars",
  "mcp__alpaca__get_latest_quote",
  "mcp__alpaca__get_orders",
  "mcp__alpaca__place_order",
  "mcp__alpaca__cancel_order",
  "mcp__alpaca__close_position",
  "mcp__alpaca__log_reasoning",
];

const DECISION_SCHEMA = {
  type: "object" as const,
  properties: {
    action: { type: "string", enum: ["buy", "sell", "hold"] },
    symbol: { type: ["string", "null"] },
    qty: { type: ["number", "null"] },
    reasoning: { type: "string" },
    market_context: { type: "string" },
    portfolio_summary: { type: "string" },
    order_id: { type: ["string", "null"] },
  },
  required: ["action", "reasoning", "market_context", "portfolio_summary"],
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isMarketOpen(config: AgentConfig): Promise<{ open: boolean; next_open?: string }> {
  const baseUrl = config.paper_trading
    ? "https://paper-api.alpaca.markets"
    : "https://api.alpaca.markets";
  try {
    const resp = await fetch(`${baseUrl}/v2/clock`, {
      headers: {
        "APCA-API-KEY-ID": config.alpaca_key_id ?? process.env.ALPACA_KEY_ID ?? "",
        "APCA-API-SECRET-KEY": config.alpaca_secret_key ?? process.env.ALPACA_SECRET_KEY ?? "",
      },
    });
    const clock = await resp.json() as { is_open: boolean; next_open: string };
    return { open: clock.is_open, next_open: clock.next_open };
  } catch {
    // If clock check fails, proceed anyway — let the agent figure it out
    return { open: true };
  }
}

export async function runAgentLoop(
  config: AgentConfig,
  opts: { log: (msg: string) => void; quiet: boolean },
): Promise<void> {
  const log = opts.log;

  const claudePath = findClaudeExecutable();
  if (!claudePath) {
    log("\x1b[31mError: Could not find 'claude' CLI.\x1b[0m");
    log("  Install: curl -fsSL https://claude.ai/install.sh | bash");
    log("  Or set CLAUDE_CODE_PATH environment variable.");
    process.exit(1);
  }

  const alpacaMcpServer = createAlpacaMcpServer(config);
  let state = loadAgentState(config.state_file);

  log(`\x1b[1m[agent] ${config.name}\x1b[0m`);
  log(`\x1b[2m  Interval: ${config.interval_seconds}s | Paper: ${config.paper_trading} | Model: ${config.model ?? "claude-sonnet-4-6"}\x1b[0m`);
  log(`\x1b[2m  Loss cap: $${config.max_daily_loss_usd} | Max position: ${(config.max_position_pct * 100).toFixed(0)}% | Max order: $${config.max_order_value_usd}\x1b[0m`);
  if (config.allowed_symbols?.length) {
    log(`\x1b[2m  Symbols: ${config.allowed_symbols.join(", ")}\x1b[0m`);
  }
  if (state.session_id) {
    log(`\x1b[2m  Resuming session ${state.session_id.slice(0, 8)}...\x1b[0m`);
  }
  log("");

  // Graceful shutdown
  let shutdownRequested = false;
  process.on("SIGINT", () => {
    if (shutdownRequested) process.exit(1); // force on second ctrl+c
    shutdownRequested = true;
    log("\n\x1b[33m[agent] Shutting down after current iteration...\x1b[0m");
    saveAgentState(state, config.state_file);
  });

  while (!shutdownRequested) {
    state = resetDailyPnlIfNewDay(state);

    if (state.halted) {
      log(`\x1b[31m[agent] HALTED: ${state.halt_reason}\x1b[0m`);
      log(`\x1b[2m  Waiting ${config.interval_seconds}s before re-checking...\x1b[0m\n`);
      await sleep(config.interval_seconds * 1000);
      state = resetDailyPnlIfNewDay(state); // un-halt on new day
      continue;
    }

    // Check market hours (without spending Claude tokens)
    if (config.run_during_market_hours_only) {
      const clock = await isMarketOpen(config);
      if (!clock.open) {
        log(`\x1b[2m[${new Date().toLocaleTimeString()}] Market closed. Next open: ${clock.next_open ?? "unknown"}\x1b[0m`);
        log(`\x1b[2m  Sleeping ${config.interval_seconds}s...\x1b[0m\n`);
        await sleep(config.interval_seconds * 1000);
        continue;
      }
    }

    state.loop_count++;
    state.last_run_at = new Date().toISOString();
    saveAgentState(state, config.state_file);

    log(`\x1b[36m[loop #${state.loop_count}]\x1b[0m ${new Date().toLocaleTimeString()}`);

    const systemPrompt = buildSystemPrompt(config);
    const loopPrompt = buildLoopPrompt(config, state.loop_count, state.daily_realized_pnl);
    const guardrailHooks = createGuardrailHooks(config, () => state);

    const sdkOptions: ClaudeCodeOptions = {
      systemPrompt,
      model: config.model ?? "claude-sonnet-4-6",
      maxTurns: config.max_turns_per_loop,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      ...(config.max_budget_usd_per_loop && { maxBudgetUsd: config.max_budget_usd_per_loop }),
      pathToClaudeCodeExecutable: claudePath,
      ...(state.session_id && { resume: state.session_id }),
      mcpServers: { alpaca: alpacaMcpServer },
      tools: [],  // disable all built-in tools
      allowedTools: ALPACA_MCP_TOOLS,
      outputFormat: { type: "json_schema", schema: DECISION_SCHEMA },
      hooks: guardrailHooks,
    };

    const loopStart = Date.now();
    let structured: Record<string, unknown> | undefined;

    try {
      const conversation = query({ prompt: loopPrompt, options: sdkOptions });

      for await (const message of conversation) {
        if (message.type === "system" && "subtype" in message && message.subtype === "init") {
          state.session_id = message.session_id;
          saveAgentState(state, config.state_file);
        }

        if (message.type === "result") {
          state.session_id = message.session_id;
          if (message.subtype === "success") {
            structured = message.structured_output as Record<string, unknown> | undefined;
            const elapsed = ((Date.now() - loopStart) / 1000).toFixed(1);
            log(`\x1b[32m  Done (${elapsed}s) | cost: $${message.total_cost_usd.toFixed(4)} | turns: ${message.num_turns}\x1b[0m`);
          } else {
            const errResult = message as unknown as { subtype: string; errors?: string[] };
            log(`\x1b[31m  Loop error: ${errResult.errors?.join(", ") ?? errResult.subtype}\x1b[0m`);
          }
        }

        if (message.type === "assistant" && "message" in message) {
          const msg = message.message as { content?: Array<{ type: string; name?: string }> };
          if (msg.content) {
            for (const block of msg.content) {
              if (block.type === "tool_use" && block.name) {
                const toolShort = block.name.replace("mcp__alpaca__", "");
                process.stdout.write(`\r\x1b[K  \x1b[2m→ ${toolShort}\x1b[0m`);
              }
            }
          }
        }
      }
      process.stdout.write("\r\x1b[K");

    } catch (err) {
      process.stdout.write("\r\x1b[K");
      const errMsg = (err as Error).message;
      log(`\x1b[31m  Error: ${errMsg}\x1b[0m`);
      saveAgentState(state, config.state_file);
      log(`\x1b[2m  Backing off 30s...\x1b[0m\n`);
      await sleep(30000);
      continue;
    }

    // Log decision
    if (structured) {
      const decision: TradeDecision = {
        timestamp: new Date().toISOString(),
        loop: state.loop_count,
        action: (structured.action as string) as "buy" | "sell" | "hold",
        symbol: structured.symbol as string | undefined,
        qty: structured.qty as number | undefined,
        reasoning: structured.reasoning as string,
        market_context: structured.market_context as string,
        portfolio_summary: structured.portfolio_summary as string,
        order_id: structured.order_id as string | undefined,
      };
      appendDecision(decision, config.decisions_log);

      const actionColor = decision.action === "hold" ? "\x1b[33m" : "\x1b[32m";
      const actionStr = decision.action === "hold"
        ? "HOLD"
        : `${decision.action.toUpperCase()} ${decision.qty ?? ""} ${decision.symbol ?? ""}`;
      log(`  ${actionColor}${actionStr}\x1b[0m`);
      log(`  \x1b[2m${decision.reasoning.slice(0, 140)}\x1b[0m`);

      // Notify on trades (not holds)
      if (config.notify && decision.action !== "hold") {
        const topic = config.notify_topic ?? "portfolio-agent";
        fetch(`https://ntfy.sh/${topic}`, {
          method: "POST",
          headers: { Title: `[${config.name}] ${actionStr}` },
          body: decision.reasoning.slice(0, 200),
        }).catch(() => {});
      }
    }

    saveAgentState(state, config.state_file);

    if (!shutdownRequested) {
      log(`\x1b[2m  Next loop in ${config.interval_seconds}s...\x1b[0m\n`);
      await sleep(config.interval_seconds * 1000);
    }
  }

  log("\n\x1b[1m[agent] Stopped. State saved.\x1b[0m");
}
