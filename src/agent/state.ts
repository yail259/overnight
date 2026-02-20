import { readFileSync, writeFileSync, existsSync, appendFileSync } from "fs";
import type { AgentLoopState, TradeDecision } from "../types.js";

export function loadAgentState(stateFile: string): AgentLoopState {
  if (existsSync(stateFile)) {
    return JSON.parse(readFileSync(stateFile, "utf-8")) as AgentLoopState;
  }
  const today = new Date().toISOString().slice(0, 10);
  return {
    loop_count: 0,
    started_at: new Date().toISOString(),
    daily_realized_pnl: 0,
    daily_pnl_date: today,
    halted: false,
  };
}

export function saveAgentState(state: AgentLoopState, stateFile: string): void {
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

export function appendDecision(decision: TradeDecision, decisionsLog: string): void {
  appendFileSync(decisionsLog, JSON.stringify(decision) + "\n");
}

export function resetDailyPnlIfNewDay(state: AgentLoopState): AgentLoopState {
  const today = new Date().toISOString().slice(0, 10);
  if (state.daily_pnl_date !== today) {
    return { ...state, daily_realized_pnl: 0, daily_pnl_date: today, halted: false, halt_reason: undefined };
  }
  return state;
}
