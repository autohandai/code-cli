# Entire Integration

Autohand Code supports [Entire](https://entire.io), a CLI tool that captures session checkpoints for coding agents. When enabled, Entire automatically records your agent sessions -- prompts, tool usage, file changes, and token consumption -- so you can rewind to earlier states, review session history, and preserve context across commits.

---

## How It Works

Entire integrates through Autohand's [hooks system](hooks.md). When you enable Entire, it registers hooks in your `.autohand/config.json` that fire on session lifecycle events. Each time the agent completes a turn, Entire captures a checkpoint containing the full session transcript and a snapshot of changed files.

The flow looks like this:

1. You start an Autohand session
2. Entire's `session-start` hook fires, initializing checkpoint tracking
3. Before each prompt, `pre-prompt` captures the user instruction
4. After each agent response, `stop` saves a full checkpoint (transcript + file state)
5. When the session ends, `session-end` performs cleanup

Checkpoints are stored on git shadow branches (`entire/<hash>`) and condensed to a permanent `entire/checkpoints/v1` branch when you commit. Your working branch stays clean -- Entire never creates commits on it.

---

## Installation

### Prerequisites

- Autohand Code CLI installed and working
- Git repository initialized
- Entire CLI installed (`brew install entireio/tap/entire` or see [Entire docs](https://entire.io/docs))

### Enable Entire

From within your git repository:

```bash
entire enable --agent autohand-code
```

This command:
- Creates `.autohand/config.json` if it does not exist
- Registers five lifecycle hooks (see [Hooks Installed](#hooks-installed) below)
- Adds a permission rule to prevent Autohand from reading Entire's internal metadata

### Verify Installation

```bash
entire status
```

You should see `autohand-code` listed as an active agent with hooks installed.

---

## Hooks Installed

`entire enable --agent autohand-code` registers the following hooks in `.autohand/config.json`:

| Hook Event | Entire Command | Purpose |
|------------|---------------|---------|
| `session-start` | `entire hooks autohand-code session-start` | Initialize session tracking |
| `pre-prompt` | `entire hooks autohand-code pre-prompt` | Capture user prompt before agent processes it |
| `stop` | `entire hooks autohand-code stop` | Save checkpoint after agent completes a turn |
| `session-end` | `entire hooks autohand-code session-end` | Finalize session state |
| `subagent-stop` | `entire hooks autohand-code subagent-stop` | Save checkpoint for subagent task completion |

All hooks are installed with a 10-second timeout and are enabled by default. Entire also adds a `notification` handler that is acknowledged but takes no checkpoint action.

### What the Config Looks Like

After enabling, your `.autohand/config.json` will contain entries like:

```json
{
  "hooks": {
    "hooks": [
      {
        "event": "session-start",
        "command": "entire hooks autohand-code session-start",
        "description": "Entire: session start checkpoint",
        "enabled": true,
        "timeout": 10000
      },
      {
        "event": "stop",
        "command": "entire hooks autohand-code stop",
        "description": "Entire: save checkpoint on agent stop",
        "enabled": true,
        "timeout": 10000
      }
    ]
  },
  "permissions": {
    "rules": [
      {
        "tool": "read_file",
        "pattern": ".entire/metadata/**",
        "action": "deny"
      }
    ]
  }
}
```

The permission rule prevents Autohand from reading Entire's internal session metadata files, which are not relevant to coding tasks.

---

## Usage

Once Entire is enabled, it works automatically in the background. No changes to your Autohand workflow are needed.

### View Session History

```bash
entire log
```

### Rewind to a Previous Checkpoint

```bash
entire rewind
```

Select a checkpoint to restore both the working tree files and the session transcript to that point.

### Check Status

```bash
entire status
```

Shows current session state, checkpoint count, and active agent.

---

## Uninstall

To remove Entire hooks from your repository:

```bash
entire disable --agent autohand-code
```

This removes all Entire hook entries from `.autohand/config.json` and cleans up the permission rules. Your existing checkpoints on `entire/checkpoints/v1` are preserved.

---

## Troubleshooting

### Hooks not firing

1. Confirm hooks are installed:
   ```bash
   entire status
   ```
2. Check that `.autohand/config.json` contains the Entire hooks:
   ```bash
   cat .autohand/config.json | grep "entire hooks"
   ```
3. Verify Entire is on your PATH:
   ```bash
   which entire
   ```

### "entire: command not found" in hooks

If Autohand runs in an environment where `entire` is not on the PATH (e.g., some IDE terminals), add the full path to the Entire binary in your hooks, or ensure your shell profile exports the correct PATH.

### Checkpoints not appearing after commits

Entire condenses checkpoints to the permanent branch when you make a git commit. If you see checkpoints in `entire status` but not in `entire log`, make a commit to trigger condensation.

### Hooks slowing down Autohand

Each hook has a 10-second timeout. If your system is slow, hooks may time out. Check Entire's logs at `.entire/logs/` for timeout errors. You can also temporarily disable individual hooks by setting `"enabled": false` in `.autohand/config.json`.

### Reinstalling hooks

If hooks get out of sync, force a reinstall:

```bash
entire disable --agent autohand-code
entire enable --agent autohand-code
```
