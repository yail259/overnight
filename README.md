# overnight

**it learns how you think**

overnight builds a profile of your coding style from Claude Code sessions, then uses it to predict what you'd type next — and executes it while you sleep. Each prediction sees what the last one did and adapts.

Not a batch queue. Not a task runner. A model of *you*.

## How it works

1. **You work normally** — overnight reads your `~/.claude/projects/` session files passively
2. **Before bed** — run `overnight` to launch the interactive TUI, which suggests plans from your recent activity
3. **While you sleep** — overnight predicts a message, executes via `claude -p`, observes the output, then predicts the next one
4. **Morning** — `overnight log` shows what happened. Review the branch, merge what you like

## The profile

This is what makes overnight different. It analyses your conversations and extracts:

- **Communication style** — tone, message length, patterns (e.g. "terse, imperative, starts with verbs")
- **Coding patterns** — languages, frameworks, preferences, things you avoid
- **Values** — what you care about (e.g. "ship fast", "minimal abstractions")
- **Current focus** — what you've been working on recently

The predictor never sees raw conversations. It sees **WHO** (your profile), **WHERE** (your direction), and **WHAT** (your workspace). Three inputs, one output: the message you'd type next.

## Adaptive prediction

```
predict message → execute via claude -p → observe output/diff/tests
       ↑                                           ↓
       └───────── feed results back ───────────────┘
```

Each prediction sees what actually happened — build errors, test failures, code changes — and adapts. The model decides what's next based on real results, not a stale plan.

## Install

```bash
npm install -g @yail259/overnight
```

## Commands

```bash
# Interactive mode — TUI with plan suggestions and streaming output
overnight
overnight --all          # show suggestions across all projects
overnight --resume       # resume the last interrupted run

# Headless — predict + execute with a specific intent
overnight start "finish the auth flow and add tests"
overnight start "refactor executor" --mode dont-stop --dry-run

# Review results
overnight log            # latest run
overnight log --all      # all runs

# Session history — see recent Claude Code messages
overnight history
overnight history --limit 50 --cwd /path/to/project

# Profile — view/update your extracted coding profile
overnight profile
overnight profile --update

# Stop a running session
overnight stop

# Configuration
overnight config                          # show current config
overnight config --set apiKey=sk-...      # set API key
overnight config --set model=claude-opus-4-6  # change prediction model
overnight config --set baseUrl=https://... # custom API endpoint
```

## Run modes

| Mode | What it does |
|------|-------------|
| **Stick to plan** | One sprint. Accomplish the stated goals, then stop. |
| **Don't stop** | Continuous sprints. After primary goals, move to docs, tests, cleanup. Runs until the model says "nothing left" or you Ctrl+C. |

## Ambition levels

- **safe** — low-risk continuations: tests, docs, cleanup, finishing near-done work
- **normal** — natural next steps, pick up where you left off
- **yolo** — bold features, refactors, ambitious improvements

## Config

Stored in `~/.overnight/config.json`. Runs stored in `~/.overnight/runs/`.

Works with Anthropic and any compatible API (GLM, Minimax, Kimi, etc.).

## Architecture

```
src/
  cli.ts         — CLI entry (start, stop, log, history, profile, config)
  types.ts       — Core types and constants
  history.ts     — Extract messages from Claude Code session JSONL files
  predictor.ts   — Profile + workspace + results → predicted messages (Anthropic API)
  executor.ts    — Adaptive execution loop, single branch per run
  interactive.ts — Interactive TUI orchestration (Anthropic SDK streaming + React Ink)
  profile.ts     — User profile extraction from conversation history
  ui/            — React Ink TUI components
```

## Building from source

```bash
git clone https://github.com/yail259/overnight.git
cd overnight
bun install
bun run build     # Build to dist/
bun run compile   # Create standalone binary
```

## License

MIT
