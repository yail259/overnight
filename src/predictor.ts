/**
 * Adaptive message prediction via multi-turn tool loop.
 *
 * The predictor receives:
 * - Workspace dump (file tree, exports, git log, README, ROADMAP)
 * - Conversation history (real user messages for voice matching)
 * - Profile summary (quick orientation)
 * - Direction (current focus/cycle)
 * - Prediction history (meta-learning: what worked before)
 *
 * It uses `sh` to run read-only shell commands (grep, sed, cat, git, etc.)
 * to verify what exists before predicting. `forget` drops tool results
 * to keep context lean. Context persists across the execution loop.
 *
 * Three modes:
 * - `predictMessages()` — upfront batch for preview/goals
 * - `predictNext()` — single adaptive step with self-evaluation
 * - `suggestPlans()` — suggest what to work on tonight
 */

import type {
  PredictedMessage,
  SuggestedPlan,
  OvernightConfig,
  AmbitionLevel,
  AdaptiveContext,
} from "./types.js";
import { createClient, extractToolInputs, type ToolDef } from "./api.js";
import { generateWorkspaceDump, generateHistoryDump, saveWorkspaceDump, runSandboxedSh } from "./context.js";
import { getProjectList } from "./history.js";
import {
  loadProfile,
  profileToPromptContext,
  extractDirection,
  directionToPromptContext,
} from "./profile.js";
import { loadPredictionProfile, predictionProfileToPromptContext } from "./meta-learning.js";

// ── Context tools ───────────────────────────────────────────────────

const SH_TOOL: ToolDef = {
  name: "sh",
  description: "Run a read-only shell command in the workspace. Use for: cat, grep, sed, head, tail, find, wc, git log, git diff, git show, etc. No writes, no network, no destructive ops. Output capped at 20KB.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to run (e.g. 'grep -n \"export function\" src/api.ts')" },
    },
    required: ["command"],
  },
};

const FORGET_TOOL: ToolDef = {
  name: "forget",
  description: "Tell the system you're done with previous tool results. Frees context for more reads. Use when you've absorbed what you need from a large output.",
  parameters: {
    type: "object",
    properties: {
      reason: { type: "string", description: "Brief note on what you learned before forgetting (helps maintain continuity)" },
    },
    required: ["reason"],
  },
};

// ── Output tools ────────────────────────────────────────────────────

const PREDICTION_TOOL: ToolDef = {
  name: "add_prediction",
  description: "Add a predicted message to send to Claude Code. Only call AFTER using sh to verify what exists. Call once per message.",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "The exact message to send to Claude Code — in the user's voice" },
      reasoning: { type: "string", description: "Why this message, and what you verified (1-2 sentences)" },
      confidence: { type: "number", description: "How confident (0-1)" },
    },
    required: ["message", "reasoning", "confidence"],
  },
};

const NEXT_STEP_TOOL: ToolDef = {
  name: "next_step",
  description: "Predict the next message or signal done. Only call AFTER verifying current state with sh.",
  parameters: {
    type: "object",
    properties: {
      done: { type: "boolean", description: "True if all goals accomplished" },
      message: { type: "string", description: "Message to send (omit if done)" },
      reasoning: { type: "string", description: "Why this step, or why done" },
      confidence: { type: "number", description: "Confidence (0-1, omit if done)" },
    },
    required: ["done", "reasoning"],
  },
};

const EVALUATE_TOOL: ToolDef = {
  name: "evaluate_step",
  description: "Evaluate the result of the previous execution step. Was the goal achieved?",
  parameters: {
    type: "object",
    properties: {
      rating: { type: "string", enum: ["good", "partial", "failed"], description: "Did the step achieve its goal?" },
      observation: { type: "string", description: "What actually happened vs what was intended" },
      course_correct: { type: "boolean", description: "Should the next step fix/redo this, or move on?" },
    },
    required: ["rating", "observation", "course_correct"],
  },
};

const PLAN_TOOL: ToolDef = {
  name: "suggest_plan",
  description: "Suggest an overnight plan. Only call AFTER using sh to verify what exists.",
  parameters: {
    type: "object",
    properties: {
      intent: { type: "string", description: "Concise intent string" },
      description: { type: "string", description: "1-2 sentences" },
      project: { type: "string", description: "Project name" },
      cwd: { type: "string", description: "Working directory" },
      estimatedMessages: { type: "number", description: "Estimated steps (1-10)" },
    },
    required: ["intent", "description", "project", "cwd", "estimatedMessages"],
  },
};

// ── Ambition prompts ────────────────────────────────────────────────

const AMBITION_PROMPT: Record<AmbitionLevel, string> = {
  tidy: `🧹 TIDY — cleanup only, no functional changes.
Dead code, formatting, unused imports, small fixes, stale docs.
DO NOT add features, refactor architecture, or change behavior.`,

  refine: `🔧 REFINE — structural improvement, same features.
Design pattern refactors, coupling reduction, test architecture.
Separation of concerns, explicit over implicit, extend existing patterns.
The product does exactly what it did before, but better.`,

  build: `🏗️ BUILD — product engineering from the business case.
Read the README. Understand the value prop. Derive the next feature.
Complete partial features before new ones. Ship working increments.
Every feature connects to the product's reason for existing.`,

  radical: `🚀 RADICAL — unhinged product visionary with good engineering taste.
Understand the soul of the product, then ask "what if it could...?"
Bold ideas nobody asked for but everyone would love. Clean implementation.
You wake up either delighted or terrified. Both acceptable. Playing safe is not.`,
};

// ── System prompts ──────────────────────────────────────────────────

function getPredictionCtx(): string {
  return predictionProfileToPromptContext(loadPredictionProfile());
}

const TOOL_INSTRUCTIONS = `
## Tools
- \`sh\` — run any read-only shell command: cat, grep, sed, head, tail, find, wc, git log, git diff, etc.
- \`forget\` — drop previous tool output from context (note what you learned first)

CRITICAL: Use sh to VERIFY what exists before predicting. Don't guess. Don't assume.
Read the actual source files. Check git log. Grep for functions. Then predict.

## Voice
You have the user's conversation history below. Read it carefully.
Your predictions must sound like THIS PERSON typed them — not like a generic prompt.
Match their word choice, sentence structure, level of specificity, and tone exactly.`;

function buildPredictSystem(ambition: AmbitionLevel, profileCtx: string, directionCtx: string): string {
  return `You are predicting what a developer would type into Claude Code.

${profileCtx}
${directionCtx}
${getPredictionCtx()}

## Mode: ${ambition.toUpperCase()}
${AMBITION_PROMPT[ambition]}

${TOOL_INSTRUCTIONS}

Call add_prediction for each message. Verify before predicting.`;
}

function buildAdaptiveSystem(
  ambition: AmbitionLevel,
  mode: "stick-to-plan" | "dont-stop",
  profileCtx: string,
  directionCtx: string,
): string {
  const modeInstr = mode === "stick-to-plan"
    ? `"Stick to plan" mode — accomplish goals then stop.`
    : `"Don't stop" mode — after goals, continue with improvements. Stop when nothing valuable left.`;

  return `You are mid-run, predicting the next step. You can see previous step results.

${profileCtx}
${directionCtx}
${modeInstr}

## Mode: ${ambition.toUpperCase()}
${AMBITION_PROMPT[ambition]}

${TOOL_INSTRUCTIONS}

First: evaluate the previous step's result if there was one.
Then: use sh to check current workspace state.
Then: call next_step with your prediction or done=true.`;
}

function buildSuggestSystem(ambition: AmbitionLevel, profileCtx: string, directionCtx: string): string {
  return `You are suggesting overnight work plans for a developer.

${profileCtx}
${directionCtx}

## Mode: ${ambition.toUpperCase()}
${AMBITION_PROMPT[ambition]}

${TOOL_INSTRUCTIONS}

Use sh to verify what exists. Don't suggest done work. Call suggest_plan for 3-5 ideas.`;
}

// ── Tool handler ────────────────────────────────────────────────────

function createToolHandler(cwd: string) {
  return (name: string, input: any): string => {
    switch (name) {
      case "sh":
        return runSandboxedSh(input.command, cwd);
      case "forget":
        return `Noted: ${input.reason}. Previous tool outputs can be dropped from context.`;
      case "evaluate_step":
        return `Evaluation recorded: ${input.rating} — ${input.observation}`;
      default:
        return `Unknown tool: ${name}`;
    }
  };
}

// ── Predict messages (batch) ────────────────────────────────────────

export async function predictMessages(
  intent: string,
  cwd: string,
  config: OvernightConfig,
  ambition: AmbitionLevel = "refine",
  runId?: string,
): Promise<PredictedMessage[]> {
  const client = createClient(config);

  const [direction, profile, workspace, history] = await Promise.all([
    extractDirection(cwd, config),
    Promise.resolve(loadProfile()),
    Promise.resolve(generateWorkspaceDump(cwd)),
    Promise.resolve(generateHistoryDump(cwd)),
  ]);

  if (runId) saveWorkspaceDump(runId, workspace);

  const profileCtx = profileToPromptContext(profile);
  const directionCtx = directionToPromptContext(direction);

  const prompt = `## Intent
"${intent}"

## Working Directory
${cwd}

${workspace}

${history}

Use sh to verify what exists, then call add_prediction for each message (up to ${config.maxMessages}).`;

  const results = await client.runToolLoop({
    model: config.model,
    maxTokens: 4096,
    system: buildPredictSystem(ambition, profileCtx, directionCtx),
    prompt,
    tools: [SH_TOOL, FORGET_TOOL, PREDICTION_TOOL],
    outputTools: ["add_prediction"],
    handleTool: createToolHandler(cwd),
    maxTurns: 20,
  });

  return extractToolInputs<PredictedMessage>(results, "add_prediction").slice(0, config.maxMessages);
}

// ── Predict next (adaptive) ─────────────────────────────────────────

export interface NextStepResult {
  done: boolean;
  prediction?: PredictedMessage;
  reasoning: string;
  evaluation?: { rating: string; observation: string; courseCorrect: boolean };
}

export async function predictNext(
  intent: string,
  cwd: string,
  config: OvernightConfig,
  context: AdaptiveContext,
): Promise<NextStepResult> {
  const client = createClient(config);

  const profile = loadProfile();
  const profileCtx = profileToPromptContext(profile);
  const directionCtx = context.direction ? directionToPromptContext(context.direction) : "";

  let prompt = `## Intent
"${intent}"

## Working Directory
${cwd}

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

  prompt += `Use sh to check current workspace state. If there was a previous step, evaluate it first. Then call next_step.`;

  // Include evaluate_step as an intermediate tool (not output)
  const results = await client.runToolLoop({
    model: config.model,
    maxTokens: 4096,
    system: buildAdaptiveSystem(context.ambition, context.mode, profileCtx, directionCtx),
    prompt,
    tools: [SH_TOOL, FORGET_TOOL, EVALUATE_TOOL, NEXT_STEP_TOOL],
    outputTools: ["next_step"],
    handleTool: createToolHandler(cwd),
    maxTurns: 15,
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

// ── Suggest plans ───────────────────────────────────────────────────

export interface SuggestPlansOptions {
  cwd?: string;
  projects?: string[];
  ambition?: AmbitionLevel;
}

export async function suggestPlans(
  config: OvernightConfig,
  opts: SuggestPlansOptions = {},
): Promise<SuggestedPlan[]> {
  const client = createClient(config);
  const ambition = opts.ambition ?? "refine";
  const profile = loadProfile();
  const profileCtx = profileToPromptContext(profile);

  if (opts.cwd) {
    const [direction, workspace, history] = await Promise.all([
      extractDirection(opts.cwd, config),
      Promise.resolve(generateWorkspaceDump(opts.cwd)),
      Promise.resolve(generateHistoryDump(opts.cwd)),
    ]);

    const directionCtx = directionToPromptContext(direction);

    const prompt = `## Scope: ${opts.cwd}\n\n${workspace}\n\n${history}\n\nUse sh to verify, then call suggest_plan for 3-5 plans.`;

    const results = await client.runToolLoop({
      model: config.model,
      maxTokens: 4096,
      system: buildSuggestSystem(ambition, profileCtx, directionCtx),
      prompt,
      tools: [SH_TOOL, FORGET_TOOL, PLAN_TOOL],
      outputTools: ["suggest_plan"],
      handleTool: createToolHandler(opts.cwd),
      maxTurns: 15,
    });

    return extractToolInputs<SuggestedPlan>(results, "suggest_plan");
  }

  // Cross-project mode
  let discovered = getProjectList();
  if (opts.projects?.length) {
    const projSet = new Set(opts.projects);
    discovered = discovered.filter((p) => projSet.has(p.name));
  }
  const topProjects = discovered.slice(0, 5);
  if (topProjects.length === 0) return [];

  const projectContexts = await Promise.all(
    topProjects.map(async (p) => ({
      project: p,
      direction: await extractDirection(p.cwd, config),
      workspace: generateWorkspaceDump(p.cwd),
    })),
  );

  const combined = projectContexts
    .map((c) => `### ${c.project.name} (${c.project.cwd})\n${directionToPromptContext(c.direction)}\n\n${c.workspace}`)
    .join("\n\n---\n\n");

  const primaryDirCtx = projectContexts[0]?.direction
    ? directionToPromptContext(projectContexts[0].direction)
    : "";

  const results = await client.runToolLoop({
    model: config.model,
    maxTokens: 4096,
    system: buildSuggestSystem(ambition, profileCtx, primaryDirCtx),
    prompt: `## Projects\n${combined}\n\nUse sh to verify, then call suggest_plan for 3-5 plans.`,
    tools: [SH_TOOL, FORGET_TOOL, PLAN_TOOL],
    outputTools: ["suggest_plan"],
    handleTool: createToolHandler(projectContexts[0]?.project.cwd ?? process.cwd()),
    maxTurns: 15,
  });

  return extractToolInputs<SuggestedPlan>(results, "suggest_plan");
}
