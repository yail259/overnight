import { readFileSync, writeFileSync, existsSync, appendFileSync } from "fs";
import type { EvolveState, EvolveCycleResult } from "../types.js";

export function loadEvolveState(stateFile: string): EvolveState {
  if (existsSync(stateFile)) {
    return JSON.parse(readFileSync(stateFile, "utf-8")) as EvolveState;
  }
  return {
    cycle_count: 0,
    started_at: new Date().toISOString(),
    completed_cycles: [],
  };
}

export function saveEvolveState(state: EvolveState, stateFile: string): void {
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

export function appendCycleResult(result: EvolveCycleResult, historyLog: string): void {
  appendFileSync(historyLog, JSON.stringify(result) + "\n");
}
