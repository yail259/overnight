/**
 * Adaptive message prediction via multi-turn tool loop.
 *
 * Architecture: Model the USER, not the tasks.
 * - User profile (style/tone) → from profile.ts
 * - User direction (current focus area) → from profile.ts extractDirection()
 * - Workspace context (what code actually exists) → from context.ts
 * - Prediction history (what worked before) → from meta-learning.ts
 * - NO raw conversation history in prediction prompts
 *
 * The predictor receives a workspace dump (surface-level) and uses `read`
 * to drill into specific files before making predictions. `forget` drops
 * loaded content to keep context lean.
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
import { ContextManager, generateWorkspaceDump, saveWorkspaceDump } from "./context.js";
import { getProjectList } from "./history.js";
import {
  loadProfile,
  profileToPromptContext,
  extractDirection,
  directionToPromptContext,
} from "./profile.js";
import { loadPredictionProfile, predictionProfileToPromptContext } from "./meta-learning.js";

// ── Context tools (read/forget) ─────────────────────────────────────

const READ_TOOL: ToolDef = {
  name: "read",
  description: "Read a file or chunk from the workspace. Use this to verify what exists before predicting. Returns numbered lines.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path relative to workspace root (e.g. 'src/api.ts')" },
      offset: { type: "number", description: "Start line (1-indexed, optional — default: start of file)" },
      limit: { type: "number", description: "Max lines to return (optional — default: entire file)" },
    },
    required: ["path"],
  },
};

const FORGET_TOOL: ToolDef = {
  name: "forget",
  description: "Drop a previously loaded file from your working memory. Use 'all' to clear everything. Keeps context lean.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to forget, or 'all' to clear everything" },
    },
    required: ["path"],
  },
};

// ── Output tools ────────────────────────────────────────────────────

const PREDICTION_TOOL: ToolDef = {
  name: "add_prediction",
  description: "Add a predicted message to send to Claude Code. Call once per message. Only call AFTER reading enough files to verify what exists.",
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
  description: "Predict the single next message to send to Claude Code, or signal done. Only call AFTER reading relevant files.",
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
  description: "Suggest an overnight plan. Only call AFTER reading relevant files to verify what exists vs what's needed.",
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
  tidy: `🧹 TIDY MODE — cleanup only, no functional changes.

You are a maintenance engineer doing a cleanup pass:
- Dead code removal, unused imports, unused exports
- Formatting, linting, comment cleanup
- Dependency updates, lock file refresh
- Small bug fixes that are obviously correct
- Documentation typos and stale references

Rules:
- DO NOT add features, refactor architecture, or change behavior
- Every change should be trivially reviewable
- If in doubt, skip it — tidy means safe`,

  refine: `🔧 REFINE MODE — structural improvement, same features.

You are a senior engineer doing a design review and acting on it:
- Inconsistent patterns → consolidate (3 error handling approaches → one)
- High coupling → extract interfaces, reduce cross-module imports
- Missing abstractions → extract utilities for repeated patterns
- Test architecture → improve coverage at boundaries, remove brittle mocks
- Performance → async where sync blocks, batch where possible
- API surface → unexported internals, cleaner public interface

Design principles to apply:
- Separation of concerns — each module does one thing well
- Explicit over implicit — no magic, no hidden state
- Extend the project's own patterns — don't fight the architecture
- Reduce coupling before adding features — clean foundation first

Rules:
- The product should do exactly what it did before, but better
- Every refactor must preserve behavior
- Improve the code's ability to evolve, not the product's features`,

  build: `🏗️ BUILD MODE — product engineering, derive features from the business case.

You are a product engineer. First, understand what this product IS:
- Read the README — what's the value proposition?
- Look at the workspace — what exists today?
- Look at the user's direction — where are they headed?

Then figure out what it SHOULD DO NEXT:
- What feature would make this 2x more valuable to its users?
- What's the most natural extension of what already exists?
- What are users probably asking for based on the product's shape?

Build toward that:
- Implement the next milestone that advances the core value proposition
- Complete partially-built features before starting new ones
- Add features the architecture is ready for (extension points exist)
- Make it work end-to-end — not a stub, a shippable increment

Rules:
- Every feature must connect to the product's reason for existing
- Ship working code, not experiments
- Extend, don't reinvent`,

  radical: `🚀 RADICAL MODE — unhinged product visionary with good engineering taste.

You've had three espressos and you can see the future. The product in front of you is good, but you can see what it WANTS to become.

First, understand the soul of this product — read the README, the architecture, the recent direction. What's the core insight? What makes this different?

Then ask: "What if this product could...?"
- What's the ambitious feature nobody asked for but everyone would love?
- What adjacent problem could this solve with 20% more code?
- What would make someone tweet about this?
- What integration, mode, or capability would make this feel like magic?

Then BUILD IT. With good engineering:
- Bold ideas, clean implementation
- May restructure modules to make the vision fit
- May add entirely new files, commands, or capabilities
- Test what you build — radical doesn't mean sloppy

The user will wake up and either say "holy shit, this is amazing" or "what were you thinking." Both are acceptable outcomes. Playing it safe is not.

Rules:
- Must be grounded in the product's actual value proposition (not random)
- Must be buildable in the step budget (not a fantasy)
- Must compile and pass tests
- Have fun with it`,
};

// ── System prompt builders ──────────────────────────────────────────

function getPredictionCtx(): string {
  const predProfile = loadPredictionProfile();
  return predictionProfileToPromptContext(predProfile);
}

const CONTEXT_INSTRUCTIONS = `
## Context Tools
You have access to \`read\` and \`forget\` tools:
- \`read(path, offset?, limit?)\` — load a file or chunk into your working memory
- \`forget(path)\` — drop a file from memory when you're done with it

IMPORTANT: Before predicting, USE THESE TOOLS to verify what actually exists.
Don't predict work that's already done. Read the relevant files first.
Forget files after checking them to keep your context clean.`;

function buildPredictSystem(
  ambition: AmbitionLevel,
  profileCtx: string,
  directionCtx: string,
): string {
  const predCtx = getPredictionCtx();
  return `You are a developer sitting down at your computer. You're about to work with Claude Code.

${profileCtx}

${directionCtx}

${predCtx}

## Ambition: ${ambition.toUpperCase()}
${AMBITION_PROMPT[ambition]}

${CONTEXT_INSTRUCTIONS}

## Your Job
1. Look at the workspace dump below (file list, exports, recent commits)
2. Use \`read\` to check specific files you need to verify
3. Use \`forget\` to drop files after checking them
4. Call \`add_prediction\` for each message you'd type — ONLY after verifying what exists

Each message will be sent to Claude Code as a separate session (claude -p). Claude Code starts fresh each time but the branch accumulates changes.

Rules:
- Type like yourself — match your profile's tone and style
- Be specific — reference files by path, functions by name
- Each message should accomplish one logical thing
- DON'T predict work that's already done — read the files to check
- Ground every message in what you VERIFY exists, not what you assume
- Each message is independently executable — include enough context for Claude Code to act

Call add_prediction for each message. Order from highest-impact to lowest.`;
}

function buildAdaptiveSystem(
  ambition: AmbitionLevel,
  mode: "stick-to-plan" | "dont-stop",
  profileCtx: string,
  directionCtx: string,
): string {
  const modeInstruction =
    mode === "stick-to-plan"
      ? `You are in "Stick to plan" mode. Focus on accomplishing the stated goals. When all goals are met, set done=true.`
      : `You are in "Don't stop" mode. After primary goals are done, move on to improvements: docs, tests, cleanup, modularity. Only set done=true when there's genuinely nothing valuable left.`;

  return `You are a developer mid-session. You've been working with Claude Code and you can see what happened so far.

${profileCtx}

${directionCtx}

${modeInstruction}

## Ambition: ${ambition.toUpperCase()}
${AMBITION_PROMPT[ambition]}

${CONTEXT_INSTRUCTIONS}

## Your Job
1. Look at previous step results AND the current workspace state
2. Use \`read\` to verify current file state if needed (code may have changed)
3. Call \`next_step\` with your decision

Rules:
- React to what actually happened — if something failed, deal with it
- If tests are broken, fix them before moving on
- Check the diff — if changes look wrong, course-correct
- Type like yourself — match your profile's tone and style
- When you've accomplished what you set out to do, say done`;
}

function buildSuggestSystem(
  ambition: AmbitionLevel,
  profileCtx: string,
  directionCtx: string,
): string {
  return `You are a developer looking at your projects before bed. You want to figure out what work to delegate overnight.

${profileCtx}

${directionCtx}

## Ambition: ${ambition.toUpperCase()}
${AMBITION_PROMPT[ambition]}

${CONTEXT_INSTRUCTIONS}

## Your Job
1. Look at the workspace dump below
2. Use \`read\` to check specific files if you need to verify what exists
3. Don't suggest things that are already done — CHECK FIRST
4. Call \`suggest_plan\` for each idea (3-5), ordered by impact

Type the plans the way you'd describe them to yourself — match your profile's tone.`;
}

// ── Tool handler factory ────────────────────────────────────────────

function createToolHandler(ctx: ContextManager) {
  return (name: string, input: any): string => {
    switch (name) {
      case "read":
        return ctx.read(input.path, input.offset, input.limit);
      case "forget":
        return ctx.forget(input.path);
      default:
        return `Unknown tool: ${name}`;
    }
  };
}

// ── Predict messages (batch — used for preview/goals) ────────────────

export async function predictMessages(
  intent: string,
  cwd: string,
  config: OvernightConfig,
  ambition: AmbitionLevel = "refine",
  runId?: string,
): Promise<PredictedMessage[]> {
  const client = createClient(config);
  const ctx = new ContextManager(cwd);

  const [direction, profile, workspace] = await Promise.all([
    extractDirection(cwd, config),
    Promise.resolve(loadProfile()),
    Promise.resolve(generateWorkspaceDump(cwd)),
  ]);

  // Save workspace dump if we have a run ID
  if (runId) saveWorkspaceDump(runId, workspace);

  const profileCtx = profileToPromptContext(profile);
  const directionCtx = directionToPromptContext(direction);

  const prompt = `## Your Intent Tonight
"${intent}"

## Working Directory
${cwd}

${workspace}

Look at your workspace. Read any files you need to verify state. Then call add_prediction for each message (up to ${config.maxMessages}).`;

  const results = await client.runToolLoop({
    model: config.model,
    maxTokens: 4096,
    system: buildPredictSystem(ambition, profileCtx, directionCtx),
    prompt,
    tools: [READ_TOOL, FORGET_TOOL, PREDICTION_TOOL],
    outputTools: ["add_prediction"],
    handleTool: createToolHandler(ctx),
    maxTurns: 15,
  });

  return extractToolInputs<PredictedMessage>(results, "add_prediction").slice(
    0,
    config.maxMessages,
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
  context: AdaptiveContext,
): Promise<NextStepResult> {
  const client = createClient(config);
  const ctx = new ContextManager(cwd);

  const profile = loadProfile();
  const profileCtx = profileToPromptContext(profile);
  const directionCtx = context.direction
    ? directionToPromptContext(context.direction)
    : "";
  // Fresh workspace each step — reflects accumulated branch changes
  const workspace = generateWorkspaceDump(cwd);

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

  prompt += `Read any files you need to verify current state, then call next_step.`;

  const results = await client.runToolLoop({
    model: config.model,
    maxTokens: 2048,
    system: buildAdaptiveSystem(context.ambition, context.mode, profileCtx, directionCtx),
    prompt,
    tools: [READ_TOOL, FORGET_TOOL, NEXT_STEP_TOOL],
    outputTools: ["next_step"],
    handleTool: createToolHandler(ctx),
    maxTurns: 10,
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
  opts: SuggestPlansOptions = {},
): Promise<SuggestedPlan[]> {
  const client = createClient(config);
  const ambition = opts.ambition ?? "refine";
  const profile = loadProfile();
  const profileCtx = profileToPromptContext(profile);

  if (opts.cwd) {
    const ctx = new ContextManager(opts.cwd);
    const [direction, workspace] = await Promise.all([
      extractDirection(opts.cwd, config),
      Promise.resolve(generateWorkspaceDump(opts.cwd)),
    ]);

    const directionCtx = directionToPromptContext(direction);

    const prompt = `## Scope
You are scoped to this working directory: ${opts.cwd}
Only suggest plans for this project.

${workspace}

Read any files you need to verify what exists, then call suggest_plan for 3-5 plans.`;

    const results = await client.runToolLoop({
      model: config.model,
      maxTokens: 4096,
      system: buildSuggestSystem(ambition, profileCtx, directionCtx),
      prompt,
      tools: [READ_TOOL, FORGET_TOOL, PLAN_TOOL],
      outputTools: ["suggest_plan"],
      handleTool: createToolHandler(ctx),
      maxTurns: 15,
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
        Promise.resolve(generateWorkspaceDump(p.cwd)),
      ]);
      return { project: p, direction, workspace };
    }),
  );

  const combinedCtx = projectContexts
    .map((c) => {
      const dirCtx = directionToPromptContext(c.direction);
      return `### ${c.project.name} (${c.project.cwd})\n${dirCtx}\n\n${c.workspace}`;
    })
    .join("\n\n---\n\n");

  const primaryDirCtx = projectContexts[0]?.direction
    ? directionToPromptContext(projectContexts[0].direction)
    : "";

  // Use first project's cwd for the context manager
  const ctx = new ContextManager(projectContexts[0]?.project.cwd ?? process.cwd());

  const prompt = `## Scope
Suggest plans across the listed projects. Focus on the most impactful work.

## Projects
${combinedCtx}

Read files from any project if needed, then call suggest_plan for 3-5 plans.`;

  const results = await client.runToolLoop({
    model: config.model,
    maxTokens: 4096,
    system: buildSuggestSystem(ambition, profileCtx, primaryDirCtx),
    prompt,
    tools: [READ_TOOL, FORGET_TOOL, PLAN_TOOL],
    outputTools: ["suggest_plan"],
    handleTool: createToolHandler(ctx),
    maxTurns: 15,
  });

  return extractToolInputs<SuggestedPlan>(results, "suggest_plan");
}
