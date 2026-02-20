import { query, type Options as ClaudeCodeOptions } from "@anthropic-ai/claude-agent-sdk";
import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import type { EvolveConfig, EvolveState, EvolvePlan, EvolveVerifyResult, EvolveCycleResult } from "../types.js";
import { findClaudeExecutable } from "../runner.js";
import { createEvolveMcpServer } from "./mcp.js";
import { createEvolveGuardrailHooks } from "./guardrails.js";
import { loadEvolveState, saveEvolveState, appendCycleResult } from "./state.js";
import {
  buildEvolveSystemPrompt,
  buildObservePlanPrompt,
  buildExecutePrompt,
  buildVerifyPrompt,
  buildProposePrompt,
} from "./prompts.js";

const PLAN_SCHEMA = {
  type: "object" as const,
  properties: {
    improvement_type: { type: "string", enum: ["bug_fix", "refactor", "test", "feature", "performance"] },
    title: { type: "string" },
    description: { type: "string" },
    files_to_modify: { type: "array", items: { type: "string" } },
    verification_commands: { type: "array", items: { type: "string" } },
    risk_assessment: { type: "string" },
  },
  required: ["improvement_type", "title", "description", "files_to_modify", "verification_commands", "risk_assessment"],
};

const VERIFY_SCHEMA = {
  type: "object" as const,
  properties: {
    all_passed: { type: "boolean" },
    build_passed: { type: "boolean" },
    tests_passed: { type: "boolean" },
    issues_found: { type: "array", items: { type: "string" } },
  },
  required: ["all_passed", "build_passed", "tests_passed", "issues_found"],
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

function git(cmd: string, cwd: string): string {
  return execSync(`git ${cmd}`, { cwd, encoding: "utf-8", timeout: 30000 }).trim();
}

function extractPrUrl(text?: string): string | undefined {
  if (!text) return undefined;
  const match = text.match(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/);
  return match?.[0];
}

interface PhaseResult {
  sessionId?: string;
  result?: string;
  structured?: Record<string, unknown>;
  cost: number;
}

async function runPhase(
  prompt: string,
  options: ClaudeCodeOptions,
  log: (msg: string) => void,
  phaseName: string,
): Promise<PhaseResult> {
  log(`  \x1b[2m[${phaseName}]\x1b[0m`);

  let sessionId: string | undefined;
  let result: string | undefined;
  let structured: Record<string, unknown> | undefined;
  let cost = 0;

  const conversation = query({ prompt, options });

  for await (const message of conversation) {
    if (message.type === "system" && "subtype" in message && message.subtype === "init") {
      sessionId = message.session_id;
    }

    if (message.type === "result") {
      sessionId = message.session_id;
      cost = message.total_cost_usd ?? 0;
      if (message.subtype === "success") {
        result = message.result_text;
        structured = message.structured_output as Record<string, unknown> | undefined;
        log(`  \x1b[32m  done ($${cost.toFixed(4)}, ${message.num_turns} turns)\x1b[0m`);
      } else {
        const errResult = message as unknown as { subtype: string; errors?: string[] };
        log(`  \x1b[31m  ${phaseName} error: ${errResult.errors?.join(", ") ?? errResult.subtype}\x1b[0m`);
      }
    }

    // Show tool use progress
    if (message.type === "assistant" && "message" in message) {
      const msg = message.message as { content?: Array<{ type: string; name?: string }> };
      if (msg.content) {
        for (const block of msg.content) {
          if (block.type === "tool_use" && block.name) {
            const toolShort = block.name.replace("mcp__evolve__", "");
            process.stdout.write(`\r\x1b[K    \x1b[2m\u2192 ${toolShort}\x1b[0m`);
          }
        }
      }
    }
  }
  process.stdout.write("\r\x1b[K");

  return { sessionId, result, structured, cost };
}

export async function runEvolveLoop(
  config: EvolveConfig,
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

  const evolveMcp = createEvolveMcpServer(config);
  let state = loadEvolveState(config.state_file);
  const guardrailHooks = createEvolveGuardrailHooks(config);
  const projectDir = config.project_dir;

  log(`\x1b[1m[evolve] ${config.name}\x1b[0m`);
  log(`\x1b[2m  Project: ${projectDir}\x1b[0m`);
  log(`\x1b[2m  Interval: ${config.interval_seconds}s | Branch: ${config.branch_prefix}* \u2192 ${config.base_branch}\x1b[0m`);
  log(`\x1b[2m  Limits: ${config.max_files_per_cycle ?? 10} files, ${config.max_lines_changed_per_cycle ?? 500} lines per cycle\x1b[0m`);
  if (config.protected_files?.length) {
    log(`\x1b[2m  Protected: ${config.protected_files.join(", ")}\x1b[0m`);
  }
  if (state.session_id) {
    log(`\x1b[2m  Resuming session ${state.session_id.slice(0, 8)}...\x1b[0m`);
  }
  log("");

  // Graceful shutdown
  let shutdownRequested = false;
  process.on("SIGINT", () => {
    if (shutdownRequested) process.exit(1);
    shutdownRequested = true;
    log("\n\x1b[33m[evolve] Shutting down after current phase...\x1b[0m");
    saveEvolveState(state, config.state_file);
  });

  while (!shutdownRequested) {
    if (config.max_cycles && state.cycle_count >= config.max_cycles) {
      log(`[evolve] Reached max_cycles (${config.max_cycles}). Stopping.`);
      break;
    }

    state.cycle_count++;
    state.last_run_at = new Date().toISOString();
    const cycleStart = Date.now();
    let totalCost = 0;
    let currentBranch: string | undefined;

    // Read roadmap if configured
    const roadmapPath = config.roadmap_file
      ? (config.roadmap_file.startsWith("/") ? config.roadmap_file : `${projectDir}/${config.roadmap_file}`)
      : undefined;
    const roadmapContent = roadmapPath && existsSync(roadmapPath)
      ? readFileSync(roadmapPath, "utf-8")
      : undefined;

    const systemPrompt = buildEvolveSystemPrompt(config);

    // Strip CLAUDECODE env var to allow nested Claude Code sessions
    const cleanEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k !== "CLAUDECODE" && v !== undefined) cleanEnv[k] = v;
    }

    const baseOptions: Partial<ClaudeCodeOptions> = {
      systemPrompt,
      model: config.model ?? "claude-sonnet-4-6",
      maxTurns: config.max_turns_per_phase ?? 60,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      pathToClaudeCodeExecutable: claudePath,
      cwd: projectDir,
      env: cleanEnv,
      mcpServers: { evolve: evolveMcp },
      hooks: guardrailHooks,
    };

    log(`\x1b[36m[cycle #${state.cycle_count}]\x1b[0m ${new Date().toLocaleTimeString()}`);

    // Ensure we're on the base branch with latest
    try {
      git(`checkout ${config.base_branch}`, projectDir);
      // Only pull if working tree is clean
      const status = git("status --porcelain", projectDir);
      if (!status) {
        try { git("pull --ff-only", projectDir); } catch { /* offline is fine */ }
      } else {
        log(`\x1b[2m  Working tree has uncommitted changes — skipping pull\x1b[0m`);
      }
    } catch (e) {
      log(`\x1b[33m  Warning: couldn't checkout ${config.base_branch}: ${(e as Error).message}\x1b[0m`);
    }

    // ══════════════════════════════════════════════
    // PHASE 1: OBSERVE + PLAN
    // ══════════════════════════════════════════════
    state.current_cycle = { cycle: state.cycle_count, phase: "observe" };
    saveEvolveState(state, config.state_file);

    let observeResult: PhaseResult;
    try {
      observeResult = await runPhase(
        buildObservePlanPrompt(config, state, roadmapContent),
        {
          ...baseOptions,
          allowedTools: ["Read", "Glob", "Grep", "Bash", "mcp__evolve__check_cycle_budget"],
          outputFormat: { type: "json_schema", schema: PLAN_SCHEMA },
          ...(state.session_id && { resume: state.session_id }),
        } as ClaudeCodeOptions,
        log,
        "observe+plan",
      );
    } catch (err) {
      log(`\x1b[31m  Observe phase crashed: ${(err as Error).message}\x1b[0m`);
      await recordFailedCycle(state, config, "observe", "Observe crashed", cycleStart, totalCost, log);
      await sleepBetweenCycles(config, shutdownRequested, log);
      continue;
    }

    state.session_id = observeResult.sessionId;
    totalCost += observeResult.cost;

    if (!observeResult.structured) {
      log("  \x1b[33mPlan phase failed to produce structured output — skipping cycle\x1b[0m");
      await recordFailedCycle(state, config, "plan", "No structured plan output", cycleStart, totalCost, log);
      await sleepBetweenCycles(config, shutdownRequested, log);
      continue;
    }

    const plan = observeResult.structured as unknown as EvolvePlan;
    log(`  \x1b[1m[${plan.improvement_type}] ${plan.title}\x1b[0m`);
    log(`  \x1b[2m${plan.description.slice(0, 140)}\x1b[0m`);

    state.current_cycle = { ...state.current_cycle, phase: "plan", plan };
    saveEvolveState(state, config.state_file);

    // ══════════════════════════════════════════════
    // CREATE BRANCH
    // ══════════════════════════════════════════════
    const branchName = `${config.branch_prefix}${slugify(plan.title)}-${Date.now().toString(36)}`;
    try {
      git(`checkout -b ${branchName}`, projectDir);
      currentBranch = branchName;
    } catch (e) {
      log(`\x1b[31m  Failed to create branch: ${(e as Error).message}\x1b[0m`);
      await recordFailedCycle(state, config, "plan", `Branch creation failed: ${(e as Error).message}`, cycleStart, totalCost, log);
      try { git(`checkout ${config.base_branch}`, projectDir); } catch {}
      await sleepBetweenCycles(config, shutdownRequested, log);
      continue;
    }

    state.current_cycle.branch_name = branchName;
    saveEvolveState(state, config.state_file);

    if (shutdownRequested) break;

    // ══════════════════════════════════════════════
    // PHASE 2: EXECUTE
    // ══════════════════════════════════════════════
    state.current_cycle.phase = "execute";
    saveEvolveState(state, config.state_file);

    let executeResult: PhaseResult;
    try {
      executeResult = await runPhase(
        buildExecutePrompt(plan),
        {
          ...baseOptions,
          allowedTools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash", "mcp__evolve__check_cycle_budget"],
          resume: state.session_id,
        } as ClaudeCodeOptions,
        log,
        "execute",
      );
    } catch (err) {
      log(`\x1b[31m  Execute phase crashed: ${(err as Error).message}\x1b[0m`);
      await abandonBranch(config, branchName, log);
      await recordFailedCycle(state, config, "execute", `Execute crashed: ${(err as Error).message}`, cycleStart, totalCost, log);
      await sleepBetweenCycles(config, shutdownRequested, log);
      continue;
    }

    state.session_id = executeResult.sessionId;
    totalCost += executeResult.cost;

    if (shutdownRequested) break;

    // ══════════════════════════════════════════════
    // PHASE 3: VERIFY
    // ══════════════════════════════════════════════
    state.current_cycle.phase = "verify";
    saveEvolveState(state, config.state_file);

    let verifyPassed = false;
    let verifyResult: PhaseResult;

    try {
      verifyResult = await runPhase(
        buildVerifyPrompt(plan),
        {
          ...baseOptions,
          allowedTools: ["Read", "Glob", "Grep", "Bash"],
          outputFormat: { type: "json_schema", schema: VERIFY_SCHEMA },
          resume: state.session_id,
        } as ClaudeCodeOptions,
        log,
        "verify",
      );
    } catch (err) {
      log(`\x1b[31m  Verify phase crashed: ${(err as Error).message}\x1b[0m`);
      await abandonBranch(config, branchName, log);
      await recordFailedCycle(state, config, "verify", `Verify crashed: ${(err as Error).message}`, cycleStart, totalCost, log);
      await sleepBetweenCycles(config, shutdownRequested, log);
      continue;
    }

    state.session_id = verifyResult.sessionId;
    totalCost += verifyResult.cost;

    const verification = verifyResult.structured as unknown as EvolveVerifyResult | undefined;
    verifyPassed = verification?.all_passed ?? false;

    if (!verifyPassed) {
      log(`  \x1b[33mVerification failed: ${verification?.issues_found?.join(", ") ?? "unknown"}\x1b[0m`);
      log("  \x1b[2mAttempting fix...\x1b[0m");

      // One fix attempt
      try {
        const fixResult = await runPhase(
          `Verification failed. Issues:\n${JSON.stringify(verification?.issues_found ?? [], null, 2)}\n\nFix these issues now.`,
          {
            ...baseOptions,
            allowedTools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash", "mcp__evolve__check_cycle_budget"],
            resume: state.session_id,
          } as ClaudeCodeOptions,
          log,
          "fix",
        );
        state.session_id = fixResult.sessionId;
        totalCost += fixResult.cost;

        // Re-verify
        const reVerifyResult = await runPhase(
          buildVerifyPrompt(plan),
          {
            ...baseOptions,
            allowedTools: ["Read", "Glob", "Grep", "Bash"],
            outputFormat: { type: "json_schema", schema: VERIFY_SCHEMA },
            resume: state.session_id,
          } as ClaudeCodeOptions,
          log,
          "re-verify",
        );
        state.session_id = reVerifyResult.sessionId;
        totalCost += reVerifyResult.cost;

        const reVerification = reVerifyResult.structured as unknown as EvolveVerifyResult | undefined;
        verifyPassed = reVerification?.all_passed ?? false;
      } catch (err) {
        log(`\x1b[31m  Fix attempt crashed: ${(err as Error).message}\x1b[0m`);
      }

      if (!verifyPassed) {
        log("  \x1b[31mFix attempt failed. Abandoning cycle.\x1b[0m");
        await abandonBranch(config, branchName, log);
        await recordFailedCycle(state, config, "verify", `Verification failed: ${verification?.issues_found?.join(", ") ?? "unknown"}`, cycleStart, totalCost, log);
        await sleepBetweenCycles(config, shutdownRequested, log);
        continue;
      }
    }

    if (shutdownRequested) break;

    // ══════════════════════════════════════════════
    // PHASE 4: PROPOSE
    // ══════════════════════════════════════════════
    state.current_cycle.phase = "propose";
    saveEvolveState(state, config.state_file);

    let prUrl: string | undefined;

    if (config.auto_pr) {
      try {
        const proposeResult = await runPhase(
          buildProposePrompt(plan, branchName, config),
          {
            ...baseOptions,
            maxTurns: 15,
            allowedTools: ["Bash"],
            resume: state.session_id,
          } as ClaudeCodeOptions,
          log,
          "propose",
        );
        state.session_id = proposeResult.sessionId;
        totalCost += proposeResult.cost;
        prUrl = extractPrUrl(proposeResult.result);
        log(`  \x1b[32mPR: ${prUrl ?? "created"}\x1b[0m`);
      } catch (err) {
        log(`\x1b[31m  Propose phase crashed: ${(err as Error).message}\x1b[0m`);
        // Changes are committed on the branch even if PR creation fails
      }
    }

    // Get diff stats for the record
    let filesChanged: string[] = [];
    try {
      const diffOutput = git(`diff --name-only ${config.base_branch}...HEAD`, projectDir);
      filesChanged = diffOutput.split("\n").filter(Boolean);
    } catch {}

    // Record successful cycle
    const cycleResult: EvolveCycleResult = {
      cycle: state.cycle_count,
      timestamp: new Date().toISOString(),
      phase_reached: "propose",
      plan_summary: `[${plan.improvement_type}] ${plan.title}`,
      files_changed: filesChanged,
      branch_name: branchName,
      pr_url: prUrl,
      verify_passed: true,
      duration_seconds: (Date.now() - cycleStart) / 1000,
      cost_usd: totalCost,
    };
    state.completed_cycles.push(cycleResult);
    state.current_cycle = undefined;
    appendCycleResult(cycleResult, config.history_log);
    saveEvolveState(state, config.state_file);

    log(`  \x1b[2mCycle #${state.cycle_count} complete: ${filesChanged.length} files, $${totalCost.toFixed(4)}, ${((Date.now() - cycleStart) / 1000).toFixed(0)}s\x1b[0m`);

    // Return to base branch for next cycle
    try { git(`checkout ${config.base_branch}`, projectDir); } catch {}

    // Notify
    if (config.notify) {
      const topic = config.notify_topic ?? "overnight-evolve";
      fetch(`https://ntfy.sh/${topic}`, {
        method: "POST",
        headers: { Title: `[evolve] ${plan.title}` },
        body: `${plan.improvement_type}: ${plan.description.slice(0, 200)}${prUrl ? `\n${prUrl}` : ""}`,
      }).catch(() => {});
    }

    await sleepBetweenCycles(config, shutdownRequested, log);
  }

  log("\n\x1b[1m[evolve] Stopped. State saved.\x1b[0m");
}

// Helpers

async function abandonBranch(config: EvolveConfig, branchName: string, log: (msg: string) => void): Promise<void> {
  try {
    // Discard uncommitted changes on the branch, then switch back
    execSync("git checkout .", { cwd: config.project_dir });
    git(`checkout ${config.base_branch}`, config.project_dir);
    git(`branch -D ${branchName}`, config.project_dir);
  } catch (e) {
    log(`\x1b[33m  Warning: cleanup failed: ${(e as Error).message}\x1b[0m`);
    try { git(`checkout ${config.base_branch}`, config.project_dir); } catch {}
  }
}

async function recordFailedCycle(
  state: EvolveState,
  config: EvolveConfig,
  phase: EvolveCycleResult["phase_reached"],
  error: string,
  cycleStart: number,
  cost: number,
  log: (msg: string) => void,
): Promise<void> {
  const cycleResult: EvolveCycleResult = {
    cycle: state.cycle_count,
    timestamp: new Date().toISOString(),
    phase_reached: phase,
    plan_summary: state.current_cycle?.plan
      ? `[${state.current_cycle.plan.improvement_type}] ${state.current_cycle.plan.title}`
      : "(no plan)",
    files_changed: [],
    verify_passed: false,
    error,
    duration_seconds: (Date.now() - cycleStart) / 1000,
    cost_usd: cost,
  };
  state.completed_cycles.push(cycleResult);
  state.current_cycle = undefined;
  appendCycleResult(cycleResult, config.history_log);
  saveEvolveState(state, config.state_file);
  log(`  \x1b[2mCycle #${state.cycle_count} failed at ${phase}: ${error}\x1b[0m`);
}

async function sleepBetweenCycles(
  config: EvolveConfig,
  shutdownRequested: boolean,
  log: (msg: string) => void,
): Promise<void> {
  if (!shutdownRequested && !(config.max_cycles && config.max_cycles <= 0)) {
    log(`\x1b[2m  Next cycle in ${config.interval_seconds}s...\x1b[0m\n`);
    await sleep(config.interval_seconds * 1000);
  }
}
