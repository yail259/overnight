import type { HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import type { AgentConfig, AgentLoopState } from "../types.js";

export function createGuardrailHooks(
  config: AgentConfig,
  getState: () => AgentLoopState,
): { PreToolUse: HookCallbackMatcher[] } {
  return {
    PreToolUse: [
      {
        matcher: "mcp__alpaca__place_order",
        hooks: [
          async (input) => {
            const state = getState();
            const hookInput = input as { tool_input?: { symbol?: string } };
            const symbol = hookInput.tool_input?.symbol;

            if (state.halted) {
              return {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse" as const,
                  permissionDecision: "deny" as const,
                  permissionDecisionReason: `Agent halted: ${state.halt_reason}`,
                },
              };
            }

            if (state.daily_realized_pnl <= -config.max_daily_loss_usd) {
              return {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse" as const,
                  permissionDecision: "deny" as const,
                  permissionDecisionReason: `Daily loss cap reached ($${Math.abs(state.daily_realized_pnl).toFixed(2)})`,
                },
              };
            }

            if (symbol && config.allowed_symbols?.length && !config.allowed_symbols.includes(symbol)) {
              return {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse" as const,
                  permissionDecision: "deny" as const,
                  permissionDecisionReason: `Symbol ${symbol} not in allowlist: ${config.allowed_symbols.join(", ")}`,
                },
              };
            }

            return {};
          },
        ],
      },
    ],
  };
}
