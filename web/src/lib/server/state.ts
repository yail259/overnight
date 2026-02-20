import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { env } from "$env/dynamic/private";

function stateDir(): string {
  return env.AGENT_STATE_DIR || resolve(process.cwd(), "..");
}

export interface AgentState {
  session_id?: string;
  loop_count: number;
  started_at: string;
  last_run_at?: string;
  daily_realized_pnl: number;
  daily_pnl_date: string;
  halted: boolean;
  halt_reason?: string;
}

export interface Decision {
  timestamp: string;
  loop: number;
  action: "buy" | "sell" | "hold";
  symbol?: string;
  qty?: number;
  reasoning: string;
  market_context: string;
  portfolio_summary: string;
  order_id?: string;
}

export function getAgentState(): AgentState | null {
  const stateFile = env.AGENT_STATE_FILE || ".portfolio-state.json";
  const filePath = resolve(stateDir(), stateFile);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

export function getDecisions(limit: number = 50): Decision[] {
  const logFile = env.AGENT_DECISIONS_LOG || "portfolio-decisions.jsonl";
  const filePath = resolve(stateDir(), logFile);
  if (!existsSync(filePath)) return [];
  try {
    const lines = readFileSync(filePath, "utf-8").trim().split("\n").filter(Boolean);
    const decisions = lines.map((line) => JSON.parse(line) as Decision);
    return decisions.slice(-limit).reverse();
  } catch {
    return [];
  }
}
