# overnight roadmap

## v0.4 — Public launch (current)

- [x] Adaptive prediction loop (predict → execute → observe → adapt)
- [x] User profile extraction from Claude Code sessions
- [x] Interactive TUI with React Ink
- [x] Landing page (workovernight.com)
- [x] OpenAI-compatible API support (API abstraction layer)
- [x] UX polish (loading states, onboarding, expectation management)
- [x] CLI theme alignment with landing page design tokens
- [x] Scrollable message area, cursor-aware input, streaming code awareness

## v0.4.1 — TUI polish (learned from Gemini CLI) ✓

- [x] Three-zone layout (message history / status / composer)
- [x] Toast system (auto-expiring transient messages)
- [x] Slash command autocomplete dropdown (visual / on typing)
- [x] Contextual shortcuts bar (changes with state)
- [x] Diff rendering in tool messages (colored +/- lines)
- [x] Session browser component (browsable past sessions)
- [ ] Wire session browser into --resume CLI flow
- [ ] User-selectable themes (dracula, solarized, etc.) — future

## v0.5 — Meta-learning ✓

- [x] Meta-learning engine (src/meta-learning.ts) — tracks run outcomes, merge rates by category/ambition, builds prediction profile
- [x] Prediction profile fed into predictor prompts (trusted/distrusted categories, confidence calibration)
- [x] Temporal context in direction extraction (day-of-week, time-of-day, cycle hints)
- [x] Principled yolo prompts (architectural analysis before ambition — SOLID, coupling, patterns)
- [x] Full slash command system (/profile, /ambition, /status, /log, /cost, /stop, /diff, /undo)
- [ ] Auto-record outcomes after run completion (wire into executor)
- [ ] Periodic outcome scanning (detect merged branches from past runs)

## v1.0 — Cloud version

The real product. Local CLI requires leaving your laptop open. Cloud means:

- Describe intent from your phone → go to bed → wake up to results
- No machine management, no "did my laptop go to sleep?"
- Pay per overnight run (compute + API costs + margin)
- Open source CLI becomes the free tier / trust-builder

### Cloud architecture (TBD)
- Managed execution environment (run `claude -p` in cloud)
- Git integration (clone → branch → execute → push)
- Result dashboard (morning review without CLI)
- Notification system (Slack/email when run completes)
- Central meta-learning store (run outcomes feed back into predictions across sessions)

### Pricing model
- Free: local CLI, your own API key
- Pro: cloud execution, managed runs, priority compute
- Team: shared profiles, org-level direction, run dashboards
