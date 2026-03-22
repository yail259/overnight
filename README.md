<div align="center">

# overnight

**it learns how you think**

[![npm](https://img.shields.io/npm/v/@yail259/overnight?style=flat-square&color=7dd3fc&labelColor=0a0a0c)](https://www.npmjs.com/package/@yail259/overnight)
[![license](https://img.shields.io/badge/license-MIT-ede9e3?style=flat-square&labelColor=0a0a0c)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude_Code-native-4ade80?style=flat-square&labelColor=0a0a0c)](https://claude.com/claude-code)

overnight builds a profile of your coding style from Claude Code sessions,<br />
then predicts what you'd type next — and executes it while you sleep.

[Website](https://workovernight.com) · [Getting Started](#install) · [Commands](#commands) · [How it Works](#how-it-works)

</div>

---

### The idea

You work with Claude Code all day. overnight reads those sessions, extracts a profile of *how you code* — your tone, your stack, your values — and uses it to predict messages that sound like you typed them. Not a batch queue. Not a task runner. A model of you.

```
predict message → execute via claude -p → observe output/diff/tests
       ↑                                           ↓
       └───────── feed results back ───────────────┘
```

Each prediction sees what actually happened — build errors, test failures, code changes — and adapts. The model decides what's next based on real results, not a stale plan.

### The profile

This is what makes overnight different. It analyses your conversations and extracts:

| | What it captures |
|---|---|
| **Communication** | Tone, message length, patterns — *"terse, imperative, starts with verbs"* |
| **Coding patterns** | Languages, frameworks, preferences, things you avoid |
| **Values** | What you care about — *"ship fast"*, *"minimal abstractions"*, *"no dead code"* |
| **Focus** | What you've been working on recently |

The predictor never sees raw conversations. It receives three inputs:

> **WHO** — your profile &nbsp; **WHERE** — your direction &nbsp; **WHAT** — your workspace

One output: the message you'd type next.

---

## Install

```bash
npm install -g @yail259/overnight
```

## Quick start

```bash
overnight                    # interactive TUI — suggests plans, streams output
overnight start "intent"     # headless — predict + execute immediately
overnight log                # review what happened overnight
```

## Commands

| Command | What it does |
|---------|-------------|
| `overnight` | Interactive TUI with plan suggestions and streaming |
| `overnight --all` | Suggest across all projects |
| `overnight --resume` | Resume the last interrupted run |
| `overnight start <intent>` | Headless predict + execute |
| `overnight start <intent> --dry-run` | Preview predictions without executing |
| `overnight start <intent> --mode dont-stop` | Continuous mode — keep going after goals are met |
| `overnight stop` | Stop a running session |
| `overnight log` | Show latest run results |
| `overnight log --all` | Show all runs |
| `overnight history` | Recent Claude Code messages |
| `overnight history --limit 50` | With message limit |
| `overnight profile` | View your extracted profile |
| `overnight profile --update` | Re-extract profile from latest sessions |
| `overnight config` | Show/set configuration |

## How it works

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   1. You work normally                                          │
│      overnight reads ~/.claude/projects/ session files           │
│                                                                 │
│   2. Before bed                                                 │
│      overnight suggests plans from recent activity               │
│      You pick one, set ambition level, go to sleep              │
│                                                                 │
│   3. While you sleep                                            │
│      predict → execute → observe → adapt → repeat               │
│      everything on overnight/{run-id} branch                    │
│                                                                 │
│   4. Morning                                                    │
│      overnight log — review the branch, merge what you like     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Run modes

| Mode | Behaviour |
|------|-----------|
| **Stick to plan** | One sprint. Accomplish the stated goals, then stop. |
| **Don't stop** | After primary goals, continue with docs, tests, cleanup. Runs until nothing left or Ctrl+C. |

### Ambition levels

| Level | Risk | What it does |
|-------|------|-------------|
| `safe` | Low | Tests, docs, cleanup, finishing near-done work |
| `normal` | Medium | Natural next steps, pick up where you left off |
| `yolo` | High | Bold features, refactors, ambitious improvements |

## Config

Stored in `~/.overnight/config.json`. Runs in `~/.overnight/runs/`.

```bash
overnight config --set apiKey=sk-...
overnight config --set model=claude-opus-4-6
overnight config --set baseUrl=https://...    # custom API endpoint
```

Works with Anthropic and any compatible API (GLM, Minimax, Kimi, etc).

## Architecture

```
src/
  cli.ts          CLI entry — start, stop, log, history, profile, config
  types.ts        Core types and constants
  history.ts      Extract messages from Claude Code session JSONL files
  predictor.ts    Profile + workspace + results → predicted messages
  executor.ts     Adaptive execution loop, single branch per run
  interactive.ts  Interactive TUI (Anthropic SDK streaming + React Ink)
  profile.ts      User profile extraction from conversation history
  ui/             React Ink TUI components
```

## Build from source

```bash
git clone https://github.com/yail259/overnight.git
cd overnight && bun install
bun run build      # → dist/
bun run compile    # → standalone binary
```

## License

MIT
