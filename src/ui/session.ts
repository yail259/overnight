/**
 * Session persistence — save/load/resume conversations.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { OVERNIGHT_DIR } from "../types.js";
import type { SessionData, Message } from "./types.js";
import type { AmbitionLevel } from "../types.js";

const SESSIONS_DIR = join(OVERNIGHT_DIR, "sessions");

export function saveSession(data: SessionData): void {
  mkdirSync(SESSIONS_DIR, { recursive: true });
  data.updatedAt = new Date().toISOString();
  writeFileSync(join(SESSIONS_DIR, `${data.id}.json`), JSON.stringify(data, null, 2));
}

export function loadSession(id: string): SessionData | null {
  const file = join(SESSIONS_DIR, `${id}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

export function getLatestSession(): SessionData | null {
  if (!existsSync(SESSIONS_DIR)) return null;
  const files = readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  try {
    return JSON.parse(readFileSync(join(SESSIONS_DIR, files[0]), "utf-8"));
  } catch {
    return null;
  }
}

export function listSessions(): SessionData[] {
  if (!existsSync(SESSIONS_DIR)) return [];
  return readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, 20)
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(SESSIONS_DIR, f), "utf-8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean) as SessionData[];
}

export function createSessionData(
  id: string,
  messages: Message[],
  apiMessages: any[],
  ambition: AmbitionLevel,
): SessionData {
  return {
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages,
    apiMessages,
    ambition,
  };
}

// ── Input history persistence ────────────────────────────────────────

const HISTORY_FILE = join(OVERNIGHT_DIR, "input-history.json");
const MAX_HISTORY = 50;

export function loadInputHistory(): string[] {
  if (!existsSync(HISTORY_FILE)) return [];
  try {
    const entries = JSON.parse(readFileSync(HISTORY_FILE, "utf-8"));
    return Array.isArray(entries) ? entries.slice(0, MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

export function saveInputHistory(entries: string[]): void {
  mkdirSync(OVERNIGHT_DIR, { recursive: true });
  writeFileSync(HISTORY_FILE, JSON.stringify(entries.slice(0, MAX_HISTORY)));
}
