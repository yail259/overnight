/**
 * User profile — built up over time from Claude Code conversation history.
 * Uses Anthropic SDK native tool_use for structured extraction.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { getAllConversationTurns, getConversationSummary } from "./history.js";
import type { OvernightConfig, UserDirection } from "./types.js";
import { OVERNIGHT_DIR } from "./types.js";
import { createClient, extractToolInputs, type ToolDef } from "./api.js";
import { execSync } from "child_process";

export const PROFILE_FILE = `${OVERNIGHT_DIR}/profile.json`;

export interface UserProfile {
  updatedAt: string;
  turnsAnalyzed: number;
  communicationStyle: { tone: string; messageLength: string; patterns: string[] };
  codingPatterns: { languages: string[]; frameworks: string[]; preferences: string[]; avoids: string[] };
  projects: Record<string, { description: string; stack: string; recentFocus: string }>;
  values: string[];
}

const DEFAULT_PROFILE: UserProfile = {
  updatedAt: "",
  turnsAnalyzed: 0,
  communicationStyle: { tone: "", messageLength: "", patterns: [] },
  codingPatterns: { languages: [], frameworks: [], preferences: [], avoids: [] },
  projects: {},
  values: [],
};

const PROFILE_TOOLS: ToolDef[] = [
  {
    name: "set_communication_style",
    description: "Set the user's communication style",
    parameters: {
      type: "object",
      properties: {
        tone: { type: "string", description: "e.g. 'terse, imperative, informal'" },
        messageLength: { type: "string", description: "e.g. 'short (1-2 sentences)'" },
        patterns: { type: "array", items: { type: "string" }, description: "e.g. ['starts with verbs']" },
      },
      required: ["tone", "messageLength", "patterns"],
    },
  },
  {
    name: "set_coding_patterns",
    description: "Set the user's coding patterns and preferences",
    parameters: {
      type: "object",
      properties: {
        languages: { type: "array", items: { type: "string" } },
        frameworks: { type: "array", items: { type: "string" } },
        preferences: { type: "array", items: { type: "string" } },
        avoids: { type: "array", items: { type: "string" } },
      },
      required: ["languages", "frameworks", "preferences", "avoids"],
    },
  },
  {
    name: "add_project",
    description: "Add or update a project in the profile",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        stack: { type: "string" },
        recentFocus: { type: "string" },
      },
      required: ["name", "description", "stack", "recentFocus"],
    },
  },
  {
    name: "set_values",
    description: "Set what the user values in their work",
    parameters: {
      type: "object",
      properties: {
        values: { type: "array", items: { type: "string" } },
      },
      required: ["values"],
    },
  },
];

const PROFILE_SYSTEM = `You are analyzing a developer's Claude Code conversation history to build a profile.

From the conversations, extract how they work by calling the provided tools:
- set_communication_style: their tone, message length, patterns
- set_coding_patterns: languages, frameworks, preferences, avoids
- add_project: each project with description, stack, focus (call once per project)
- set_values: what they care about

Be specific and concrete. "prefers terse messages starting with verbs" not "communicates efficiently".
Call ALL relevant tools in a single response.`;

export function loadProfile(): UserProfile {
  if (existsSync(PROFILE_FILE)) {
    try {
      return { ...DEFAULT_PROFILE, ...JSON.parse(readFileSync(PROFILE_FILE, "utf-8")) };
    } catch {
      return { ...DEFAULT_PROFILE };
    }
  }
  return { ...DEFAULT_PROFILE };
}

function saveProfile(profile: UserProfile): void {
  mkdirSync(OVERNIGHT_DIR, { recursive: true });
  writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2));
}

export async function updateProfile(config: OvernightConfig): Promise<UserProfile> {
  const turns = getAllConversationTurns({ tokenBudget: 80_000 });
  if (turns.length === 0) return loadProfile();

  const existing = loadProfile();
  const summary = getConversationSummary(turns);
  const existingContext = existing.turnsAnalyzed > 0
    ? `\n\n## Existing Profile (update, don't replace)\n${JSON.stringify(existing, null, 2)}`
    : "";

  const client = createClient(config);

  const results = await client.callWithTools({
    model: config.model,
    maxTokens: 4096,
    system: PROFILE_SYSTEM,
    prompt: `## Recent Conversation History\n${summary}${existingContext}\n\nAnalyze and call the tools.`,
    tools: PROFILE_TOOLS,
  });

  const profile: UserProfile = {
    ...existing,
    updatedAt: new Date().toISOString(),
    turnsAnalyzed: turns.length,
  };

  for (const result of results) {
    const input = result.input as any;

    switch (result.name) {
      case "set_communication_style":
        profile.communicationStyle = {
          tone: input.tone ?? "",
          messageLength: input.messageLength ?? "",
          patterns: input.patterns ?? [],
        };
        break;
      case "set_coding_patterns":
        profile.codingPatterns = {
          languages: input.languages ?? [],
          frameworks: input.frameworks ?? [],
          preferences: input.preferences ?? [],
          avoids: input.avoids ?? [],
        };
        break;
      case "add_project":
        profile.projects[input.name] = {
          description: input.description ?? "",
          stack: input.stack ?? "",
          recentFocus: input.recentFocus ?? "",
        };
        break;
      case "set_values":
        profile.values = input.values ?? [];
        break;
    }
  }

  saveProfile(profile);
  return profile;
}

export function profileToPromptContext(profile: UserProfile): string {
  if (!profile.updatedAt) return "";

  const lines: string[] = ["## User Profile"];

  if (profile.communicationStyle.tone) {
    lines.push(`Communication: ${profile.communicationStyle.tone}, ${profile.communicationStyle.messageLength}`);
    if (profile.communicationStyle.patterns.length > 0)
      lines.push(`Patterns: ${profile.communicationStyle.patterns.join(", ")}`);
  }

  if (profile.codingPatterns.languages.length > 0)
    lines.push(`Languages: ${profile.codingPatterns.languages.join(", ")}`);
  if (profile.codingPatterns.frameworks.length > 0)
    lines.push(`Frameworks: ${profile.codingPatterns.frameworks.join(", ")}`);
  if (profile.codingPatterns.preferences.length > 0)
    lines.push(`Preferences: ${profile.codingPatterns.preferences.join(", ")}`);
  if (profile.codingPatterns.avoids.length > 0)
    lines.push(`Avoids: ${profile.codingPatterns.avoids.join(", ")}`);

  if (Object.keys(profile.projects).length > 0) {
    lines.push("\nProjects:");
    for (const [name, info] of Object.entries(profile.projects))
      lines.push(`- ${name}: ${info.description} (${info.stack}) — focus: ${info.recentFocus}`);
  }

  if (profile.values.length > 0)
    lines.push(`\nValues: ${profile.values.join(", ")}`);

  return lines.join("\n");
}

// ── Direction extraction ─────────────────────────────────────────────

const DIRECTION_TOOL: ToolDef = {
  name: "set_direction",
  description: "Set the user's current working direction — trajectory, NOT tasks",
  parameters: {
    type: "object",
    properties: {
      area: {
        type: "string",
        description:
          "High-level area of focus (1-2 sentences). NOT a task — an area. " +
          "GOOD: 'interactive TUI for the overnight tool' " +
          "BAD: 'add scroll support to TUI'",
      },
      workType: {
        type: "string",
        description: "Kind of work: building-new, refactoring, debugging, polishing, exploring, maintaining",
      },
      themes: {
        type: "array",
        items: { type: "string" },
        description:
          "Architectural patterns or design themes being pursued. " +
          "e.g. 'extracting shared utilities', 'adding resilience/retry logic'",
      },
      tensions: {
        type: "array",
        items: { type: "string" },
        description:
          "What the user seems frustrated with or wants to improve. Signals, not tasks. " +
          "GOOD: 'code duplication across agent modes' " +
          "BAD: 'refactor agent modes to share code'",
      },
      momentum: {
        type: "string",
        description:
          "What's gaining energy vs winding down. " +
          "e.g. 'Heavy iteration on TUI, executor work seems settled'",
      },
    },
    required: ["area", "workType", "themes", "tensions", "momentum"],
  },
};

/** Get conceptual cycle context from git state — not wall clock, actual development phase */
function getCycleContext(cwd: string): string {
  const lines: string[] = ["## Development Cycle Signals"];

  try {
    // Recent merge commits → just shipped something (post-ship phase)
    const merges = execSync("git log --merges --oneline -3 2>/dev/null", { cwd, stdio: "pipe", timeout: 5_000 }).toString().trim();
    if (merges) {
      const firstMerge = merges.split("\n")[0];
      lines.push(`Recent merges: ${firstMerge}`);
    }

    // Working tree state → what phase are they in?
    const status = execSync("git status --short 2>/dev/null", { cwd, stdio: "pipe", timeout: 5_000 }).toString().trim();
    if (!status) {
      lines.push("Clean working tree — between tasks, ready for new work.");
    } else {
      const changedFiles = status.split("\n").length;
      lines.push(`Working tree: ${changedFiles} changed files — mid-task.`);
    }

    // Commit frequency → iteration speed
    const recentCommits = execSync("git log --oneline -10 --format='%ar' 2>/dev/null", { cwd, stdio: "pipe", timeout: 5_000 }).toString().trim();
    const commitLines = recentCommits.split("\n").filter(Boolean);
    if (commitLines.length > 0) {
      lines.push(`Recent commit pace: ${commitLines[0]} (latest), ${commitLines.length} in recent history`);
    }

    // Branch state → feature branch vs main
    const branch = execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", { cwd, stdio: "pipe", timeout: 5_000 }).toString().trim();
    if (branch && branch !== "main" && branch !== "master") {
      lines.push(`On feature branch: ${branch} — likely mid-feature.`);
    } else {
      lines.push(`On main branch — between features or doing maintenance.`);
    }

    // Test state → are things passing?
    const hasTests = execSync("find . -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' 2>/dev/null | head -1", { cwd, stdio: "pipe", timeout: 5_000 }).toString().trim();
    if (hasTests) {
      lines.push("Test files exist — test health is a signal.");
    }
  } catch {}

  return lines.join("\n");
}

const DIRECTION_SYSTEM = `You are analyzing a developer's recent Claude Code conversations to understand their DIRECTION — where they're headed, not what they need to do.

CRITICAL DISTINCTION:
- WRONG: "User needs to add error handling to executor.ts" (this is a TASK)
- RIGHT: "User is focused on making the execution pipeline more robust" (this is a DIRECTION)
- WRONG: "User should refactor the profile module" (this is a TASK)
- RIGHT: "User is moving toward cleaner separation between data extraction and presentation" (this is a DIRECTION)

Think about:
- What AREA of the codebase has their attention?
- What KIND of work are they doing? (building new? polishing? debugging? refactoring?)
- What THEMES keep coming up? (patterns they're pursuing across multiple changes)
- What TENSIONS exist? (what seems to bother them, what do they keep coming back to?)
- What's the MOMENTUM? (what's active vs settling down?)
- What CYCLE are they in? Detect from git state and conversation content:
  - build cycle (new code, feature branch, lots of additions)
  - fix cycle (debugging, test failures, small targeted changes)
  - ship cycle (clean tree, recent merges, polishing)
  - plan cycle (between features, discussing architecture, exploring)

Do NOT extract specific tasks, TODOs, or action items. Extract the trajectory.
Call set_direction with your analysis.`;

/** Extract the user's current working direction from recent conversations.
 *  Ephemeral — not persisted, extracted fresh per run. */
export async function extractDirection(
  cwd: string,
  config: OvernightConfig
): Promise<UserDirection> {
  // Get recently touched files from git (ground truth, no Claude needed)
  let recentlyTouched: string[] = [];
  try {
    const raw = execSync(
      "git log --name-only --pretty=format: -20 2>/dev/null | sort -u | head -30",
      { cwd, stdio: "pipe", timeout: 5_000 }
    ).toString().trim();
    recentlyTouched = raw.split("\n").filter(Boolean);
  } catch {}

  // Get conversation turns for direction extraction
  const turns = getAllConversationTurns({ cwd, tokenBudget: 30_000 });

  if (turns.length === 0) {
    // No history — return a bare direction from git only
    return {
      extractedAt: new Date().toISOString(),
      cwd,
      area: "unknown — no conversation history available",
      workType: "exploring",
      themes: [],
      tensions: [],
      momentum: "no recent activity detected",
      recentlyTouched,
    };
  }

  const summary = getConversationSummary(turns);

  const client = createClient(config);

  const results = await client.callWithTools({
    model: config.model,
    maxTokens: 2048,
    system: DIRECTION_SYSTEM,
    prompt: `${getCycleContext(cwd)}\n\n## Recent Conversation History (${turns.length} turns)\n${summary}\n\nExtract the developer's current direction. Use the cycle signals to detect which phase of development they're in. Call set_direction.`,
    tools: [DIRECTION_TOOL],
  });

  const directionResults = extractToolInputs<any>(results, "set_direction");

  if (directionResults.length === 0) {
    return {
      extractedAt: new Date().toISOString(),
      cwd,
      area: "could not extract direction",
      workType: "exploring",
      themes: [],
      tensions: [],
      momentum: "",
      recentlyTouched,
    };
  }

  const input = directionResults[0];
  return {
    extractedAt: new Date().toISOString(),
    cwd,
    area: input.area ?? "",
    workType: input.workType ?? "exploring",
    themes: input.themes ?? [],
    tensions: input.tensions ?? [],
    momentum: input.momentum ?? "",
    recentlyTouched,
  };
}

/** Format a UserDirection into prompt context */
export function directionToPromptContext(direction: UserDirection): string {
  const lines: string[] = ["## Your Current Direction"];
  lines.push(`Area: ${direction.area}`);
  lines.push(`Work type: ${direction.workType}`);
  if (direction.themes.length > 0)
    lines.push(`Themes: ${direction.themes.join(", ")}`);
  if (direction.tensions.length > 0)
    lines.push(`Tensions: ${direction.tensions.join(", ")}`);
  if (direction.momentum)
    lines.push(`Momentum: ${direction.momentum}`);
  if (direction.recentlyTouched.length > 0)
    lines.push(`Recently touched: ${direction.recentlyTouched.slice(0, 15).join(", ")}`);
  return lines.join("\n");
}
