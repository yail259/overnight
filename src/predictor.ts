/**
 * Adaptive message prediction via the API abstraction layer.
 *
 * Architecture: Model the USER, not the tasks.
 * - User profile (style/tone) → from profile.ts
 * - User direction (current focus area) → from profile.ts extractDirection()
 * - Workspace snapshot (what code actually exists) → from git/filesystem
 * - NO raw conversation history in prediction prompts
 *
 * Three modes:
 * - `predictMessages()` — upfront batch for preview/goals (used by preview_run)
 * - `predictNext()` — single adaptive step, sees previous results (used by executor loop)
 * - `suggestPlans()` — suggest what to work on tonight
 */

import type {
  PredictedMessage,
  SuggestedPlan,
  OvernightConfig,
  AmbitionLevel,
  AdaptiveContext,
  UserDirection,
} from "./types.js";
import { createClient, extractToolInputs, type ToolDef } from "./api.js";
import { getProjectList } from "./history.js";
import {
  loadProfile,
  profileToPromptContext,
  extractDirection,
  directionToPromptContext,
} from "./profile.js";
import { loadPredictionProfile, predictionProfileToPromptContext } from "./meta-learning.js";
import { execSync } from "child_process";

// ── Helpers ──────────────────────────────────────────────────────────

/** Shell command runner with timeout */
function run(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, stdio: "pipe", timeout: 5_000 }).toString().trim();
  } catch {
    return "";
  }
}

/** Capture a rich workspace snapshot — what the developer would SEE when they sit down */
function getWorkspaceSnapshot(cwd: string): string {
  const lines: string[] = ["## Workspace State"];

  const branch = run("git rev-parse --abbrev-ref HEAD", cwd);
  if (branch) lines.push(`Branch: ${branch}`);

  const commits = run("git log --oneline -10", cwd);
  if (commits) lines.push(`\nRecent commits:\n${commits}`);

  const status = run("git status --short", cwd);
  if (status) lines.push(`\nWorking tree:\n${status}`);

  const srcFiles = run(
    "find src -name '*.ts' -o -name '*.tsx' 2>/dev/null | sort | head -50",
    cwd
  );
  if (srcFiles) lines.push(`\nSource files:\n${srcFiles}`);

  const pkgScripts = run(
    `node -e "try{const p=require('./package.json');console.log(Object.keys(p.scripts||{}).join(', '))}catch{}" 2>/dev/null`,
    cwd
  );
  if (pkgScripts) lines.push(`\nAvailable scripts: ${pkgScripts}`);

  const readme = run("head -15 README.md 2>/dev/null", cwd);
  if (readme) lines.push(`\nREADME (first 15 lines):\n${readme}`);

  const recentChanges = run("git diff --stat HEAD~5..HEAD 2>/dev/null", cwd);
  if (recentChanges) lines.push(`\nRecent changes (last 5 commits):\n${recentChanges}`);

  const testFiles = run(
    "find . -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' 2>/dev/null | head -10",
    cwd
  );
  if (testFiles) lines.push(`\nTest files:\n${testFiles}`);

  return lines.join("\n");
}

// ── Tool schemas (provider-agnostic) ─────────────────────────────────

const PREDICTION_TOOL: ToolDef = {
  name: "add_prediction",
  description: "Add a predicted message to send to Claude Code. Call once per message.",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "The exact message to send to Claude Code" },
      reasoning: { type: "string", description: "Why this message is important (1 sentence)" },
      confidence: { type: "number", description: "How confident you are (0-1)" },
    },
    required: ["message", "reasoning", "confidence"],
  },
};

const NEXT_STEP_TOOL: ToolDef = {
  name: "next_step",
  description: "Predict the single next message to send to Claude Code, or signal that the work is done.",
  parameters: {
    type: "object",
    properties: {
      done: {
        type: "boolean",
        description: "Set to true if all goals are accomplished and there's nothing meaningful left to do",
      },
      message: {
        type: "string",
        description: "The exact message to send to Claude Code (omit if done=true)",
      },
      reasoning: {
        type: "string",
        description: "Why this is the right next step, or why we're done (1 sentence)",
      },
      confidence: {
        type: "number",
        description: "How confident you are (0-1, omit if done=true)",
      },
    },
    required: ["done", "reasoning"],
  },
};

const PLAN_TOOL: ToolDef = {
  name: "suggest_plan",
  description: "Suggest an overnight plan. Call once per plan.",
  parameters: {
    type: "object",
    properties: {
      intent: { type: "string", description: "Concise intent string" },
      description: { type: "string", description: "1-2 sentences on what this accomplishes" },
      project: { type: "string", description: "Project name" },
      cwd: { type: "string", description: "Working directory" },
      estimatedMessages: { type: "number", description: "Estimated CC messages needed (1-10)" },
    },
    required: ["intent", "description", "project", "cwd", "estimatedMessages"],
  },
};

// ── Ambition-tuned prompts ───────────────────────────────────────────

const AMBITION_PROMPT: Record<AmbitionLevel, string> = {
  safe: `Focus on SAFE, LOW-RISK work only:
- Tests, documentation, cleanup, consolidation
- Completing work that's 80%+ done
- Fixing known bugs or tech debt
- DO NOT suggest anything experimental or risky
- Keep scope small and predictable`,

  normal: `Suggest NATURAL NEXT STEPS:
- Pick up where momentum is heading
- Complete partially-done features
- Address obvious gaps (missing tests, incomplete implementations)
- Balance between continuation and modest new work
- Things you'd naturally do next`,

  yolo: `You are a senior engineer doing a design review. Think structurally, not just ambitiously:

ARCHITECTURAL ANALYSIS — before predicting, look for:
- Inconsistent patterns (3 different error handling approaches → consolidate to one)
- High coupling (modules that import too many siblings → extract interfaces)
- Missing abstractions (repeated 5-line patterns → extract utility)
- Test coverage gaps (critical paths with no tests → add them)
- Performance bottlenecks (synchronous I/O in hot paths → async)
- API surface bloat (exported functions nobody calls → clean up)

DESIGN PRINCIPLES to apply:
- Separation of concerns — each module does one thing well
- Explicit over implicit — no magic, no hidden state
- Extend the project's own patterns — don't fight the architecture, improve it
- Reduce coupling before adding features — clean foundation first
- Test at boundaries, not internals

THEN be ambitious:
- Bold refactors that improve the structural health of the codebase
- Features that the architecture is clearly ready for (the extension points exist)
- After primary goals, improve modularity, docs, and high-value tests
- Don't hold back — but make every change defensible on engineering principles`,
};

// ── System prompt builders (user-model framing) ──────────────────────

function getPredictionCtx(): string {
  const predProfile = loadPredictionProfile();
  return predictionProfileToPromptContext(predProfile);
}

function buildPredictSystem(
  ambition: AmbitionLevel,
  profileCtx: string,
  directionCtx: string
): string {
  const predCtx = getPredictionCtx();
  return `You are a developer sitting down at your computer. You're about to work with Claude Code.

You have a specific style, preferences, and a direction you're heading in. You're going to type messages into Claude Code to get work done tonight.

${profileCtx}

${directionCtx}

${predCtx}

## Ambition: ${ambition.toUpperCase()}
${AMBITION_PROMPT[ambition]}

## Your Job
Look at your workspace. Look at your direction. What would you type?

Each message you generate will be sent to Claude Code as a separate session (claude -p). Claude Code starts fresh each time but the branch accumulates changes.

Rules:
- Type like yourself — match the tone, length, and style in your profile
- Be specific — you can see the actual files, so reference them by path
- Each message should accomplish one logical thing
- Don't repeat yourself — if a file exists and looks right, move on
- Ground every message in what you SEE in the workspace, not what you remember from conversations
- Each message is independently executable — include enough context for Claude Code to act

Call add_prediction for each message you'd type. Order from highest-impact to lowest.`;
}

function buildAdaptiveSystem(
  ambition: AmbitionLevel,
  mode: "stick-to-plan" | "dont-stop",
  profileCtx: string,
  directionCtx: string
): string {
  const modeInstruction =
    mode === "stick-to-plan"
      ? `You are in "Stick to plan" mode. Focus on accomplishing the stated goals. When all goals are met, set done=true.`
      : `You are in "Don't stop" mode. After primary goals are done, move on to improvements: docs, high-value tests, cleanup, modularity. Only set done=true when there's genuinely nothing valuable left.`;

  return `You are a developer mid-session. You've been working with Claude Code and you can see what happened so far.

${profileCtx}

${directionCtx}

${modeInstruction}

## Ambition: ${ambition.toUpperCase()}
${AMBITION_PROMPT[ambition]}

## Your Job
Look at what happened in the previous steps. Look at the current workspace state. What would you type next?

Rules:
- React to what actually happened — if something failed, deal with it
- If tests are broken, fix them before moving on
- Check the diff — if changes look wrong, course-correct
- Type like yourself — match your profile's tone and style
- Be specific — reference files by path, functions by name
- When you've accomplished what you set out to do, say done

Call next_step with your decision.`;
}

function buildSuggestSystem(
  ambition: AmbitionLevel,
  profileCtx: string,
  directionCtx: string
): string {
  return `You are a developer looking at your projects before bed. You want to figure out what work to delegate overnight.

${profileCtx}

${directionCtx}

## Ambition: ${ambition.toUpperCase()}
${AMBITION_PROMPT[ambition]}

## Your Job
Look at the workspace state below. Don't suggest things that are already done — check the actual source files and recent commits. Suggest work that aligns with where you're headed.

Type the plans the way you'd describe them to yourself — match your profile's tone.

Call suggest_plan for each idea (3-5). Order by impact.`;
}

// ── Predict messages (batch — used for preview/goals) ────────────────

export async function predictMessages(
  intent: string,
  cwd: string,
  config: OvernightConfig,
  ambition: AmbitionLevel = "normal"
): Promise<PredictedMessage[]> {
  const client = createClient(config);

  const [direction, profile] = await Promise.all([
    extractDirection(cwd, config),
    Promise.resolve(loadProfile()),
  ]);

  const profileCtx = profileToPromptContext(profile);
  const directionCtx = directionToPromptContext(direction);
  const workspace = getWorkspaceSnapshot(cwd);

  const prompt = `## Your Intent Tonight
"${intent}"

## Working Directory
${cwd}

${workspace}

Look at your workspace. Given your direction and this intent, what messages would you type into Claude Code?
Call add_prediction for each (up to ${config.maxMessages}).`;

  const results = await client.callWithTools({
    model: config.model,
    maxTokens: 4096,
    system: buildPredictSystem(ambition, profileCtx, directionCtx),
    prompt,
    tools: [PREDICTION_TOOL],
  });

  return extractToolInputs<PredictedMessage>(results, "add_prediction").slice(
    0,
    config.maxMessages
  );
}

// ── Predict next (adaptive — used by executor loop) ──────────────────

interface NextStepResult {
  done: boolean;
  prediction?: PredictedMessage;
  reasoning: string;
}

export async function predictNext(
  intent: string,
  cwd: string,
  config: OvernightConfig,
  context: AdaptiveContext
): Promise<NextStepResult> {
  const client = createClient(config);

  const profile = loadProfile();
  const profileCtx = profileToPromptContext(profile);
  const directionCtx = context.direction
    ? directionToPromptContext(context.direction)
    : "";
  const workspace = getWorkspaceSnapshot(cwd);

  let prompt = `## Intent
"${intent}"

## Working Directory
${cwd}

${workspace}

`;

  if (context.goals && context.goals.length > 0) {
    prompt += `## Goals\n${context.goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}\n\n`;
  }

  if (context.completedSteps.length > 0) {
    prompt += `## Previous Steps (${context.completedSteps.length} completed)\n`;
    for (let i = 0; i < context.completedSteps.length; i++) {
      const step = context.completedSteps[i];
      const status = step.exitCode === 0 ? "OK" : "FAILED";
      const tests = step.testsPass ? "tests pass" : "tests fail";
      const build = step.buildPass ? "build pass" : "build fail";
      prompt += `\n### Step ${i + 1} [${status}] — ${tests}, ${build}\nMessage: "${step.message}"\n`;
      if (step.diff) prompt += `Diff:\n${step.diff}\n`;
      if (step.output) prompt += `Output (last 2KB):\n${step.output.slice(-2000)}\n`;
    }
    prompt += "\n";
  } else {
    prompt += `## Previous Steps\nNone yet — this is the first step.\n\n`;
  }

  prompt += `Call next_step with either the next message to send, or done=true if the work is complete.`;

  const results = await client.callWithTools({
    model: config.model,
    maxTokens: 2048,
    system: buildAdaptiveSystem(context.ambition, context.mode, profileCtx, directionCtx),
    prompt,
    tools: [NEXT_STEP_TOOL],
  });

  const steps = extractToolInputs<{
    done: boolean;
    message?: string;
    reasoning: string;
    confidence?: number;
  }>(results, "next_step");

  if (steps.length === 0) {
    return { done: true, reasoning: "No prediction returned" };
  }

  const result = steps[0];

  if (result.done || !result.message) {
    return { done: true, reasoning: result.reasoning };
  }

  return {
    done: false,
    prediction: {
      message: result.message,
      reasoning: result.reasoning,
      confidence: result.confidence ?? 0.7,
    },
    reasoning: result.reasoning,
  };
}

// ── Suggest plans ────────────────────────────────────────────────────

export interface SuggestPlansOptions {
  cwd?: string;
  projects?: string[];
  ambition?: AmbitionLevel;
}

export async function suggestPlans(
  config: OvernightConfig,
  opts: SuggestPlansOptions = {}
): Promise<SuggestedPlan[]> {
  const client = createClient(config);
  const ambition = opts.ambition ?? "normal";
  const profile = loadProfile();
  const profileCtx = profileToPromptContext(profile);

  if (opts.cwd) {
    const [direction, workspace] = await Promise.all([
      extractDirection(opts.cwd, config),
      Promise.resolve(getWorkspaceSnapshot(opts.cwd)),
    ]);

    const directionCtx = directionToPromptContext(direction);

    const prompt = `## Scope
You are scoped to this working directory: ${opts.cwd}
Only suggest plans for this project.

${workspace}

Look at your workspace and direction. What would be the best uses of overnight work?
Call suggest_plan for 3-5 plans. Order by impact.`;

    const results = await client.callWithTools({
      model: config.model,
      maxTokens: 4096,
      system: buildSuggestSystem(ambition, profileCtx, directionCtx),
      prompt,
      tools: [PLAN_TOOL],
    });

    return extractToolInputs<SuggestedPlan>(results, "suggest_plan");
  }

  // Cross-project mode
  let discovered = getProjectList();
  if (opts.projects && opts.projects.length > 0) {
    const projSet = new Set(opts.projects);
    discovered = discovered.filter((p) => projSet.has(p.name));
  }
  const topProjects = discovered.slice(0, 5);

  if (topProjects.length === 0) return [];

  const projectContexts = await Promise.all(
    topProjects.map(async (p) => {
      const [direction, workspace] = await Promise.all([
        extractDirection(p.cwd, config),
        Promise.resolve(getWorkspaceSnapshot(p.cwd)),
      ]);
      return { project: p, direction, workspace };
    })
  );

  const combinedDirectionCtx = projectContexts
    .map((ctx) => {
      const dirCtx = directionToPromptContext(ctx.direction);
      return `### ${ctx.project.name} (${ctx.project.cwd})\n${dirCtx}\n\n${ctx.workspace}`;
    })
    .join("\n\n---\n\n");

  const primaryDirection = projectContexts[0]?.direction;
  const primaryDirCtx = primaryDirection
    ? directionToPromptContext(primaryDirection)
    : "";

  const prompt = `## Scope
Suggest plans across the listed projects. Focus on the most impactful work.

## Projects
${combinedDirectionCtx}

Look at each project's workspace and direction. What would be the best overnight plans?
Call suggest_plan for 3-5 plans. Order by impact.`;

  const results = await client.callWithTools({
    model: config.model,
    maxTokens: 4096,
    system: buildSuggestSystem(ambition, profileCtx, primaryDirCtx),
    prompt,
    tools: [PLAN_TOOL],
  });

  return extractToolInputs<SuggestedPlan>(results, "suggest_plan");
}
