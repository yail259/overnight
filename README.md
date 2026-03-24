<div align="center">

# overnight

**it learns how you think**

[![npm](https://img.shields.io/npm/v/@yail259/overnight?style=flat-square&color=7dd3fc&labelColor=0a0a0c)](https://www.npmjs.com/package/@yail259/overnight)
[![license](https://img.shields.io/badge/license-MIT-ede9e3?style=flat-square&labelColor=0a0a0c)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude_Code-native-4ade80?style=flat-square&labelColor=0a0a0c)](https://claude.com/claude-code)

overnight reads your Claude Code sessions, builds a profile of how you code,<br />
and predicts what you'd type next — then executes it while you sleep.

[Website](https://workovernight.com) · [Getting Started](#install) · [Commands](#commands) · [How it Works](#how-it-works)

<img src="https://workovernight.com/image.png" alt="overnight TUI" width="700" />

</div>

---

### The idea

You work with Claude Code all day. overnight reads those sessions — your actual messages, your tone, your patterns — and learns to predict what you'd type next. Before bed, describe what you want done. overnight predicts each message, executes it, observes the result, and adapts.

Not a batch queue. Not a task runner. A model of *you*.

```
predict message → execute via claude -p → observe output/diff/tests
       ↑                                           ↓
       └──── evaluate result, adapt, repeat ────────┘
```

### How it's different

The predictor has a `sh` tool — it can run any read-only shell command (`grep`, `cat`, `git diff`, `find`, etc.) to verify what actually exists before predicting. It reads your conversation history for voice matching, checks source files to avoid suggesting done work, and evaluates its own results after each step.

| Input | What it sees |
|---|---|
| **Your profile** | Communication style, coding patterns, values — extracted from real conversations |
| **Your voice** | Actual messages you typed in Claude Code — not descriptions, real samples |
| **Your workspace** | File tree, exports, git log, README, ROADMAP — via `sh` tool on demand |
| **Previous results** | Diffs, test output, build status from each completed step |
| **Meta-learning** | Which prediction categories you merge vs discard over time |

---

## Install

```bash
npm install -g @yail259/overnight
```

Supports Anthropic and OpenAI-compatible APIs (GPT-4o, Groq, Together, Ollama, etc).

## Quick start

```bash
overnight                    # interactive TUI — suggests plans, streams output
overnight start "intent"     # headless — predict + execute immediately
overnight log                # review what happened overnight
```

## Modes

| Mode | What overnight does |
|------|-------------|
| 🧹 `tidy` | Cleanup. Dead code, formatting, small fixes. No functional changes. |
| 🔧 `refine` | Structural improvement. Design patterns, coupling, test architecture. Same features, better code. |
| 🏗️ `build` | Product engineering. Derives the next feature from the business case. Ships working increments. |
| 🚀 `radical` | Unhinged product visionary. Bold ideas nobody asked for but everyone would love. You wake up delighted or terrified. |

## Commands

| Command | What it does |
|---------|-------------|
| `overnight` | Interactive TUI with plan suggestions |
| `overnight --all` | Suggest across all projects |
| `overnight --resume` | Resume an interrupted run |
| `overnight start <intent>` | Headless predict + execute |
| `overnight start <intent> --dry-run` | Preview predictions without executing |
| `overnight stop` | Stop a running session |
| `overnight log` | Show latest run results |
| `overnight profile` | View your extracted profile |
| `overnight config` | Show/set configuration |

### TUI slash commands

| Command | What it does |
|---------|-------------|
| `/profile` | Show your profile inline |
| `/ambition <mode>` | Set mode: tidy, refine, build, radical |
| `/status` | Current run status |
| `/log` | Latest run results |
| `/cost` | API cost breakdown |
| `/diff` | Git diff of overnight branch |
| `/undo` | Revert last overnight commit |
| `/help` | All commands and keybindings |

## How it works

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   1. You work normally                                          │
│      overnight reads ~/.claude/projects/ session files           │
│                                                                 │
│   2. Before bed                                                 │
│      overnight suggests plans from recent activity               │
│      You pick a mode (tidy/refine/build/radical), go to sleep   │
│                                                                 │
│   3. While you sleep                                            │
│      sh("grep ...") → verify state → predict → execute          │
│      evaluate result → sh("git diff") → adapt → repeat          │
│      everything on overnight/{run-id} branch                    │
│                                                                 │
│   4. Morning                                                    │
│      overnight log — review the branch, merge what you like     │
│      meta-learning records what you kept vs discarded            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Run modes

| Mode | Behaviour |
|------|-----------|
| **Stick to plan** | One sprint. Accomplish the stated goals, then stop. |
| **Don't stop** | After primary goals, continue improvements. Runs until nothing left or Ctrl+C. |

## Config

```bash
overnight config --set apiKey=sk-...
overnight config --set model=claude-opus-4-6
overnight config --set baseUrl=https://...       # custom API endpoint
overnight config --set apiProvider=openai         # for OpenAI-compatible APIs
```

Stored in `~/.overnight/config.json`. Runs in `~/.overnight/runs/`.

## Architecture

```
src/
  cli.ts          CLI entry — start, stop, log, history, profile, config
  types.ts        Core types and constants
  context.ts      Workspace dump, sh tool (sandboxed), conversation history
  api.ts          API abstraction — Anthropic + OpenAI, single-shot + multi-turn
  predictor.ts    Multi-turn prediction with sh/forget tools + self-evaluation
  executor.ts     Adaptive loop, checkpoint/resume, meta-learning integration
  interactive.ts  Interactive TUI (Anthropic SDK streaming + React Ink)
  profile.ts      User profile + direction extraction
  meta-learning.ts  Track merge/discard outcomes, prediction calibration
  history.ts      Extract messages from Claude Code session JSONL files
  ui/             React Ink TUI (toast, composer, shortcuts, command dropdown, etc.)
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
