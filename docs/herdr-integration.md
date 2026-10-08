# Herdr Integration

Autohand Code reports its state to [Herdr](https://herdr.dev), the terminal runtime that keeps coding agents running in persistent panes. Run `autohand` inside a Herdr pane and Herdr shows whether it is `idle`, `working`, or `blocked`, notifies you when it finishes or needs a decision, lets scripts wait on it with `herdr agent wait`, and brings the same session back after a Herdr server restart.

There is nothing to install or configure. Outside Herdr the integration does nothing.

---

## How It Works

Herdr sets `HERDR_ENV=1`, `HERDR_PANE_ID`, and `HERDR_BIN_PATH` for every process in a pane. When Autohand starts with those variables set, it observes its own lifecycle hook events and reports them to the owning pane through the Herdr CLI, following Herdr's [Add Herdr support to your agent](https://herdr.dev/docs/add-herdr-support/) contract.

| Lifecycle event | Herdr sees |
| --- | --- |
| `session-start` | `idle`, plus the session id and the resume command `autohand resume <session-id>` |
| `pre-prompt`, `pre-tool` | `working` |
| `permission-request` | `blocked`, with the tool or command that needs approval |
| `pre-tool` for `ask_followup_question` | `blocked`, waiting for your answer |
| `post-tool` and other turn progress while blocked | `working` |
| `stop`, `rate-limit`, `session-error` | `idle` |
| `session-end` on quit or exit | the pane is released |

`/new` keeps the pane and reports the replacement session instead of releasing it. Reports go out in the background with a short timeout, one call in flight at a time; if several state changes queue up, only the latest is sent. Failures are ignored so Herdr can never slow a turn down.

The reports use `--source autohand-code` and `--agent autohand`. Herdr ignores a report whose sequence number is not higher than the last one it accepted, so Autohand uses a monotonic clock-based sequence that keeps increasing across restarts.

---

## Session Resume

After a Herdr server restart, Herdr reopens the pane in the same directory and runs `autohand resume <session-id>`. The session restores its own model and settings, so no other flags are needed. Herdr users can turn this off with `[session] resume_agents_on_restore = false`; Herdr 0.9.2 or later is required for resume, while state reports work on older versions.

---

## Verifying

Inside a Herdr pane:

```bash
herdr pane get "$HERDR_PANE_ID"
herdr agent list
```

The pane should list `autohand` with its current state and session id. To test restore without touching your normal session, start `herdr --session autohand-test`, run `autohand` in a pane, stop the session with `herdr session stop autohand-test`, then start it again. The pane runs the resume command and Autohand reports again.
