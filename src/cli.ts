#!/usr/bin/env node
/**
 * overnight CLI — another you for when you're asleep.
 *
 * Commands:
 *   overnight                 — interactive chat (default)
 *   overnight start "intent"  — adaptive prediction + execution on a single branch
 *   overnight stop            — stop a running overnight session
 *   overnight log             — show results of the latest run
 *   overnight profile         — show/update your user profile
 *   overnight config          — show/set configuration
 */

import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import {
  type OvernightConfig,
  type OvernightRun,
  type RunMode,
  DEFAULT_CONFIG,
  OVERNIGHT_DIR,
  RUNS_DIR,
  CONFIG_FILE,
  PID_FILE,
} from "./types.js";
import { predictMessages } from "./predictor.js";
import { executeAll, getLatestRun } from "./executor.js";
import { getMessagesForCwd, getAllMessages, getMessageSummary } from "./history.js";
import type { AmbitionLevel } from "./types.js";
import { runInteractive } from "./interactive.js";
import { loadProfile, updateProfile, profileToPromptContext } from "./profile.js";
import { createInterface } from "readline";

// ── Helpers ──────────────────────────────────────────────────────────

function loadConfig(): OvernightConfig {
  if (existsSync(CONFIG_FILE)) {
    try {
      const raw = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
      return { ...DEFAULT_CONFIG, ...raw };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config: OvernightConfig): void {
  mkdirSync(OVERNIGHT_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function generateRunId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toISOString().slice(11, 16).replace(":", "");
  const rand = Math.random().toString(36).slice(2, 6);
  return `${date}-${time}-${rand}`;
}

function getCurrentBranch(cwd: string): string {
  try {
    const { execSync } = require("child_process");
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd, stdio: "pipe" })
      .toString()
      .trim();
  } catch {
    return "main";
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function statusIcon(result: { exitCode: number; testsPass: boolean; buildPass: boolean }): string {
  if (result.exitCode !== 0) return "✗";
  if (!result.buildPass) return "⚠";
  if (!result.testsPass) return "⚠";
  return "✓";
}

// ── Commands ─────────────────────────────────────────────────────────

const program = new Command();

program
  .name("overnight")
  .description("another you for when you're asleep — adaptive Claude Code message prediction")
  .version("0.5.0");

// ── start ────────────────────────────────────────────────────────────

program
  .command("start")
  .argument("<intent>", "What you want accomplished overnight")
  .option("-m, --mode <mode>", "Run mode: stick-to-plan or dont-stop", "stick-to-plan")
  .option("-d, --dry-run", "Predict messages but don't execute them")
  .option("--cwd <dir>", "Working directory", process.cwd())
  .action(async (intent: string, opts: { mode: string; dryRun?: boolean; cwd: string }) => {
    const config = loadConfig();
    const mode: RunMode = opts.mode === "dont-stop" ? "dont-stop" : "stick-to-plan";

    const cwd = opts.cwd;
    const modeLabel = mode === "stick-to-plan" ? "Stick to plan" : "Don't stop";
    console.log(`\n  overnight — another you for when you're asleep`);
    console.log(`  intent: "${intent}"`);
    console.log(`  mode: ${modeLabel}`);
    console.log(`  cwd: ${cwd}\n`);

    // Step 1: Predict initial goals
    console.log("  Predicting goals...\n");
    let predictions;
    try {
      predictions = await predictMessages(intent, cwd, config);
    } catch (err: any) {
      console.error(`  Error predicting messages: ${err.message}`);
      process.exit(1);
    }

    if (predictions.length === 0) {
      console.log("  No messages predicted. Nothing to do.");
      process.exit(0);
    }

    // Show goals
    for (let i = 0; i < predictions.length; i++) {
      const p = predictions[i];
      const conf = Math.round(p.confidence * 100);
      console.log(`  ${i + 1}. [${conf}%] ${p.message}`);
      console.log(`     ${p.reasoning}\n`);
    }

    if (opts.dryRun) {
      console.log("  Dry run — not executing.");
      process.exit(0);
    }

    // Step 2: Execute adaptively
    const runId = generateRunId();
    const baseBranch = getCurrentBranch(cwd);
    const branchName = `overnight/${runId}`;

    const run: OvernightRun = {
      id: runId,
      intent,
      startedAt: new Date().toISOString(),
      cwd,
      baseBranch,
      branch: branchName,
      mode,
      predictions: [predictions[0]], // start with first
      results: [],
      status: "running",
    };

    // Save run file + PID
    mkdirSync(RUNS_DIR, { recursive: true });
    writeFileSync(join(RUNS_DIR, `${runId}.json`), JSON.stringify(run, null, 2));
    writeFileSync(PID_FILE, String(process.pid));

    console.log(`  Starting adaptive run (${runId})...\n`);

    await executeAll(run, config, {
      onStart: (prediction, index) => {
        console.log(`  → Step ${index + 1}: ${prediction.message.slice(0, 70)}...`);
      },
      onProgress: (result, index) => {
        const icon = statusIcon(result);
        const dur = formatDuration(result.durationSeconds);
        console.log(`  ${icon} Step ${index + 1}: [${dur}]`);
        if (!result.testsPass) console.log(`    ⚠ tests failed`);
        if (!result.buildPass) console.log(`    ⚠ build failed`);
        console.log();
      },
      onPrediction: (prediction, reasoning) => {
        if (prediction) {
          console.log(`  → Next: ${prediction.message.slice(0, 70)}`);
        } else {
          console.log(`  → Done: ${reasoning}`);
        }
      },
    });

    // Cleanup PID file
    try { require("fs").unlinkSync(PID_FILE); } catch {}

    // Summary
    const totalTime = run.results.reduce((s, r) => s + r.durationSeconds, 0);
    const passed = run.results.filter((r) => r.exitCode === 0).length;

    console.log(`  Done! ${passed}/${run.results.length} steps succeeded`);
    console.log(`  Branch: ${run.branch}`);
    console.log(`  Total: ${formatDuration(totalTime)}`);
    console.log(`  Run: overnight log\n`);
  });

// ── stop ─────────────────────────────────────────────────────────────

program
  .command("stop")
  .description("Stop a running overnight session")
  .action(() => {
    if (!existsSync(PID_FILE)) {
      console.log("  No overnight session running.");
      process.exit(0);
    }

    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);

    // Mark the latest run as stopped
    const latest = getLatestRun();
    if (latest && latest.status === "running") {
      latest.status = "stopped";
      const runFile = join(RUNS_DIR, `${latest.id}.json`);
      writeFileSync(runFile, JSON.stringify(latest, null, 2));
    }

    try {
      process.kill(pid, "SIGTERM");
      console.log(`  Stopped overnight (pid ${pid}).`);
    } catch {
      console.log("  Process already exited.");
    }

    try { require("fs").unlinkSync(PID_FILE); } catch {}
  });

// ── log ──────────────────────────────────────────────────────────────

program
  .command("log")
  .description("Show results of the latest run")
  .option("-a, --all", "Show all runs")
  .action((opts: { all?: boolean }) => {
    if (!existsSync(RUNS_DIR)) {
      console.log("  No runs yet. Run: overnight start \"your intent\"");
      process.exit(0);
    }

    if (opts.all) {
      const files = readdirSync(RUNS_DIR)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .reverse();

      if (files.length === 0) {
        console.log("  No runs found.");
        process.exit(0);
      }

      console.log(`\n  ${files.length} runs:\n`);
      for (const f of files) {
        const run = JSON.parse(readFileSync(join(RUNS_DIR, f), "utf-8")) as OvernightRun;
        const passed = run.results.filter((r) => r.exitCode === 0).length;
        console.log(`  ${run.id}  ${run.status}  ${run.mode}  ${passed}/${run.results.length} ok  "${run.intent.slice(0, 50)}"`);
      }
      console.log();
      return;
    }

    const run = getLatestRun();
    if (!run) {
      console.log("  No runs found.");
      process.exit(0);
    }

    console.log(`\n  Run: ${run.id}`);
    console.log(`  Status: ${run.status}`);
    console.log(`  Mode: ${run.mode}`);
    console.log(`  Branch: ${run.branch}`);
    console.log(`  Intent: "${run.intent}"`);
    console.log(`  Started: ${run.startedAt}`);
    if (run.finishedAt) console.log(`  Finished: ${run.finishedAt}`);
    console.log();

    if (run.results.length === 0 && run.predictions.length > 0) {
      console.log("  Goals (not yet executed):\n");
      for (let i = 0; i < run.predictions.length; i++) {
        const p = run.predictions[i];
        console.log(`  ${i + 1}. ${p.message}`);
      }
      console.log();
      return;
    }

    for (let i = 0; i < run.results.length; i++) {
      const r = run.results[i];
      const icon = statusIcon(r);
      console.log(`  ${icon} ${i + 1}. ${r.message}`);
      console.log(`     ${formatDuration(r.durationSeconds)}`);
      if (!r.testsPass) console.log(`     ⚠ tests failed`);
      if (!r.buildPass) console.log(`     ⚠ build failed`);
      console.log();
    }

    const totalTime = run.results.reduce((s, r) => s + r.durationSeconds, 0);
    const passed = run.results.filter((r) => r.exitCode === 0).length;
    console.log(`  Total: ${passed}/${run.results.length} ok, ${formatDuration(totalTime)}\n`);
  });

// ── history ──────────────────────────────────────────────────────────

program
  .command("history")
  .description("Show your recent Claude Code message history")
  .option("-n, --limit <n>", "Number of messages", "30")
  .option("--cwd <dir>", "Filter by working directory")
  .action((opts: { limit: string; cwd?: string }) => {
    const limit = parseInt(opts.limit, 10);
    const messages = opts.cwd
      ? getMessagesForCwd(opts.cwd, limit * 500)
      : getAllMessages({ tokenBudget: limit * 500 });

    if (messages.length === 0) {
      console.log("  No Claude Code message history found.");
      console.log("  Use Claude Code normally — overnight reads your session files.\n");
      process.exit(0);
    }

    console.log(`\n  ${messages.length} recent messages:\n`);
    for (const m of messages) {
      const time = m.timestamp ? new Date(m.timestamp).toLocaleString() : "?";
      const proj = m.project || "?";
      const text = m.text.length > 80 ? m.text.slice(0, 77) + "..." : m.text;
      console.log(`  [${time}] (${proj}) ${text}`);
    }
    console.log();
  });

// ── config ───────────────────────────────────────────────────────────

program
  .command("config")
  .description("Show or set configuration")
  .option("--set <key=value>", "Set a config value")
  .option("--reset", "Reset to defaults")
  .action((opts: { set?: string; reset?: boolean }) => {
    if (opts.reset) {
      saveConfig(DEFAULT_CONFIG);
      console.log("  Config reset to defaults.\n");
      return;
    }

    if (opts.set) {
      const config = loadConfig();
      const [key, value] = opts.set.split("=");
      if (!(key in config)) {
        console.error(`  Unknown config key: ${key}`);
        console.error(`  Valid keys: ${Object.keys(config).join(", ")}`);
        process.exit(1);
      }

      const typedKey = key as keyof OvernightConfig;
      if (typeof config[typedKey] === "number") {
        (config as any)[key] = parseFloat(value);
      } else {
        (config as any)[key] = value;
      }
      saveConfig(config);
      console.log(`  Set ${key} = ${value}\n`);
      return;
    }

    // Show current config
    const config = loadConfig();
    const labels: Record<string, string> = {
      claudeBin: "Claude CLI path",
      maxMessages: "Max steps per run (safety cap)",
      model: "Model for predictions",
      apiKey: "API key",
      baseUrl: "API base URL",
      apiProvider: "API provider (anthropic or openai)",
    };
    console.log("\n  overnight config:\n");
    for (const [key, value] of Object.entries(config)) {
      const label = labels[key] ?? key;
      const display = key === "apiKey" && value ? `${String(value).slice(0, 10)}...` : value;
      console.log(`  ${label}: ${display || "(not set)"}`);
    }
    console.log(`\n  Config file: ${CONFIG_FILE}`);
    console.log(`  Set values: overnight config --set key=value\n`);
  });

// ── profile ──────────────────────────────────────────────────────────

program
  .command("profile")
  .description("Show or update your user profile")
  .option("-u, --update", "Rebuild profile from conversation history")
  .action(async (opts: { update?: boolean }) => {
    if (opts.update) {
      const config = loadConfig();
      console.log("\n  Analyzing your Claude Code history...\n");
      try {
        const profile = await updateProfile(config);
        console.log(`  Profile updated (${profile.turnsAnalyzed} turns analyzed).\n`);
        console.log(profileToPromptContext(profile));
        console.log();
      } catch (err: any) {
        console.error(`  Error: ${err.message}`);
        process.exit(1);
      }
      return;
    }

    const profile = loadProfile();
    if (!profile.updatedAt) {
      console.log("\n  No profile yet. Run: overnight profile --update\n");
      return;
    }
    console.log(`\n  Last updated: ${new Date(profile.updatedAt).toLocaleString()}`);
    console.log(`  Turns analyzed: ${profile.turnsAnalyzed}\n`);
    console.log(profileToPromptContext(profile));
    console.log();
  });

// ── default (interactive) ────────────────────────────────────────────

// If no command is given, launch interactive mode
program
  .option("-a, --all", "Cross-project mode — suggest plans across all projects")
  .option("-r, --resume", "Resume the latest interactive session")
  .action(async (opts: { all?: boolean; resume?: boolean }) => {
    const config = loadConfig();
    await runInteractive(config, { all: opts.all, resume: opts.resume });
  });

// ── Parse ────────────────────────────────────────────────────────────

program.parse();
