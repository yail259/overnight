# overnight

Batch job runner for Claude Code. Queue tasks, run them unattended, get results. Designed for overnight/AFK use.

## Features

- **Crash Recovery** - Auto-checkpoints after each job. Use `overnight resume` to continue after interrupts.
- **Retry Logic** - Auto-retries 3x on API/network errors with exponential backoff.
- **Push Notifications** - `--notify` sends completion summary to ntfy.sh (free, no signup).
- **Markdown Reports** - `-r report.md` generates a summary with status and next steps.
- **Verification Loops** - Optionally runs a verification prompt after each task.
- **Secure by Default** - No Bash access by default. Whitelist tools per-task.

## Installation

```bash
# npm
npm install -g overnight

# bun
bun install -g overnight

# npx (no install)
npx overnight run tasks.yaml
```

Requires Claude Code CLI installed and authenticated.

## Quick Start

```bash
# Create a tasks.yaml file
overnight init

# Edit with your tasks, then run
overnight run tasks.yaml

# Run with notifications and report
overnight run tasks.yaml --notify -r report.md
```

## Commands

| Command | Description |
|---------|-------------|
| `overnight run <file>` | Run jobs from YAML file |
| `overnight resume <file>` | Resume interrupted run from checkpoint |
| `overnight single "<prompt>"` | Run a single task directly |
| `overnight init` | Create example tasks.yaml |

## tasks.yaml Format

```yaml
defaults:
  timeout_seconds: 300      # Per-task timeout (default: 300)
  stall_timeout_seconds: 120  # No-activity timeout (default: 120)
  verify: true              # Run verification pass (default: true)
  allowed_tools:            # Whitelist tools (default: Read,Edit,Write,Glob,Grep)
    - Read
    - Edit
    - Glob
    - Grep

tasks:
  # Simple format
  - "Fix the bug in auth.py"

  # Detailed format
  - prompt: "Add input validation"
    timeout_seconds: 600
    verify: false
    allowed_tools: [Read, Edit, Bash, Glob, Grep]
```

## CLI Options

### `overnight run`

| Option | Description |
|--------|-------------|
| `-o, --output <file>` | Save results JSON |
| `-r, --report <file>` | Generate markdown report |
| `-s, --state-file <file>` | Custom checkpoint file |
| `--notify` | Send push notification via ntfy.sh |
| `--notify-topic <topic>` | ntfy.sh topic (default: overnight) |
| `-q, --quiet` | Minimal output |

### `overnight single`

| Option | Description |
|--------|-------------|
| `-t, --timeout <secs>` | Timeout in seconds (default: 300) |
| `--verify/--no-verify` | Run verification pass (default: true) |
| `-T, --tools <tool...>` | Allowed tools (can specify multiple) |

## Example Workflows

### Development: Run overnight, check in morning

```bash
nohup overnight run tasks.yaml --notify -r report.md -o results.json > overnight.log 2>&1 &
```

### CI/CD: Run and fail if any task fails

```bash
overnight run tasks.yaml -q
```

### Single task with Bash access

```bash
overnight single "Run tests and fix failures" -T Read -T Edit -T Bash -T Glob
```

### Resume after crash/interrupt

```bash
overnight resume tasks.yaml
```

## Push Notifications

overnight uses [ntfy.sh](https://ntfy.sh) for push notifications - free, no signup required.

```bash
# Send to default topic
overnight run tasks.yaml --notify

# Send to custom topic
overnight run tasks.yaml --notify --notify-topic my-overnight-jobs
```

To receive notifications:
1. Install the ntfy app ([iOS](https://apps.apple.com/app/ntfy/id1625396347), [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy))
2. Subscribe to your topic (default: `overnight`)
3. Run with `--notify`

## Crash Recovery

overnight automatically saves state after each completed job to `.overnight-state.json`.

If the run is interrupted (crash, Ctrl+C, network issues):

```bash
# Resume from last checkpoint
overnight resume tasks.yaml

# Resume with custom state file
overnight resume tasks.yaml --state-file my-state.json
```

The state file is automatically deleted on successful completion.

## Security

By default, overnight only allows safe file operations:
- `Read` - Read files
- `Edit` - Edit files
- `Write` - Write files
- `Glob` - Find files by pattern
- `Grep` - Search file contents

**No Bash access by default.** To enable Bash for specific tasks:

```yaml
tasks:
  - prompt: "Run tests and fix failures"
    allowed_tools:
      - Read
      - Edit
      - Bash
      - Glob
      - Grep
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All tasks succeeded |
| 1 | One or more tasks failed |

## Files Created

| File | Description |
|------|-------------|
| `.overnight-state.json` | Checkpoint file (deleted on success) |
| `report.md` | Summary report (if `-r` used) |
| `results.json` | Full results (if `-o` used) |

## Job Statuses

| Status | Description |
|--------|-------------|
| `success` | Task completed successfully |
| `failed` | Task encountered an error |
| `timeout` | Task exceeded timeout |
| `stalled` | Task had no activity for too long |
| `verification_failed` | Verification found issues |

## Requirements

- Node.js 18+ or Bun
- Claude Code CLI installed and authenticated
- `@anthropic-ai/claude-agent-sdk` (installed automatically)

## Building from Source

```bash
git clone https://github.com/yail259/overnight.git
cd overnight
bun install
bun run compile  # Creates standalone binary
```

## License

MIT
