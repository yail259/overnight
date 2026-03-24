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

## v0.4.1 — TUI polish (learned from Gemini CLI)

### Composer pattern
Restructure the input area into a Composer component that stacks: loading state, context usage, toast messages, suggestions, and the input prompt. Currently these are scattered across app.tsx. A unified Composer creates a predictable, dense bottom panel.

### Toast system
Transient messages that appear above input and auto-dismiss after 2-3 seconds. Replace permanent system messages for ephemeral feedback: "Press Ctrl+C again to exit", "Queue cleared", "Ambition: yolo". Keep system messages in history only for meaningful events (run started, completed, errors).

### Slash command autocomplete dropdown
When user types `/`, show a visual dropdown of matching commands with descriptions and active-item highlighting. Currently tab-complete works but is invisible — the user has to know commands exist.

### Contextual shortcuts help
Show available keyboard shortcuts below the input area, contextual to current state: during streaming show "Esc cancel", during approval show "1/2 to select mode", during idle show "⇧Tab ambition · /help commands".

### Diff rendering in messages
Use the existing `renderDiff()` for tool messages that contain diffs. Show colored +/- lines inline instead of raw text. Especially valuable for execution result summaries.

### Session browser
Enhance `--resume` to show a browsable list of past sessions with: timestamp, intent, step count, pass/fail stats. Currently just grabs latest.

### Responsive layout
Three-zone architecture: scrollable message area (top, grows), optional run status (middle, fixed), composer (bottom, fixed). Explicit height management so the input never gets pushed off-screen during long outputs.

### Future: theme system
User-selectable themes (dracula, solarized, github-dark, etc.). Low priority but high delight factor. The current palette is fixed — a theme system would let users match their terminal aesthetic.

## v0.5 — Meta-learning

### Merge/discard feedback loop
overnight predicts → executes → user reviews branch in the morning. What they merge vs discard is gold signal.

- Track run outcomes: which steps got merged, which got discarded/reverted
- Calibrate prediction confidence against actual merge rates (not model self-assessment)
- Evolve the profile from "who you are" to "who you are + what works for you overnight"
- Two developers with identical styles may have very different overnight tolerance — one trusts bold refactors, the other only wants safe test additions

### Cyclical workflow patterns
Developers don't work linearly — they cycle:

- **Build → test → fix → build** (tight loop within a feature)
- **Feature → polish → ship → plan next** (weekly rhythm)
- **Deep work → context switch → deep work** (daily pattern)
- **Monday energy → Friday cleanup** (weekly pattern)

Session timestamps already contain this signal. overnight should track what kind of work happens when and use temporal context to weight predictions:
- Thursday night after a feature merge → predict cleanup
- Monday morning → predict ambitious new work
- Just shipped? → predict docs, changelog, dependency updates

### Principled yolo prompts
Current yolo is "think big, don't hold back." Better yolo should be informed by:

- Software design principles (SOLID, separation of concerns, coupling reduction)
- The project's own architectural patterns (extend them, don't fight them)
- Technical debt signals (3 different error handling patterns → consolidate)
- Performance hints (slow tests → parallelization)

Reframe yolo as: "You are a senior engineer doing a design review. What structural improvements have the highest leverage?"

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
