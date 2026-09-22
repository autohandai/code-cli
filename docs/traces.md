# Agent traces and Work Map

Autohand Code installs `ahtraces` alongside the main `autohand` binary when
you use the official macOS/Linux installer, Windows installer, Homebrew formula,
or release archive. The trace monitor is a separately built Autohand sub agent.
It is disabled by default and does not run until you make an explicit consent
choice.

Local monitoring is available after consent. Cloud metadata sync and trace
visibility in Autohand Console are included with paid Autohand Code plans,
including Team.

Trace ingestion and storage does not count against Autohand API usage.

## Install or upgrade

The official installers download both executables from the same release:

```bash
# macOS or Linux
curl -fsSL https://autohand.ai/install.sh | sh
```

```powershell
# Windows PowerShell
iwr -useb https://autohand.ai/install.ps1 | iex
```

Homebrew users can install or upgrade with:

```bash
brew install autohandai/code/autohand-code
brew upgrade autohandai/code/autohand-code
```

Confirm that both commands are available:

```bash
autohand --version
ahtraces --version
```

New users choose a trace mode during onboarding. Existing users are prompted
once after upgrading to a consent-aware release. Cancelling the prompt leaves
tracing off and asks again during a later interactive start.

## Choose a consent mode

Open `/settings` inside an interactive Autohand session when you need a mode
other than the command-line default.

| Mode | Local behavior | Cloud behavior |
| --- | --- | --- |
| Disabled | The monitor is stopped and derived local trace data is removed. | Nothing is uploaded. |
| Local Work Map only | Supported session files are read locally and reduced to aggregate signals. | Nothing is uploaded. |
| Cloud sync, metadata only | Local monitoring and Work Map stay on. | Pseudonymous timing, agent, model, provider, reasoning, token, relationship, and outcome metadata is uploaded. |
| Cloud sync, redacted full traces | Local monitoring and Work Map stay on. | Metadata plus bounded, redacted prompts, responses, reasoning, and tool parts can be uploaded. |

`autohand --traces-on`, `autohand traces on`, `ah traces on`, and `ahtraces on`
enable local monitoring with metadata only cloud sync. Full trace content
always requires the separate choice in `/settings`.

## Control the monitor

```bash
autohand --traces-on
autohand --traces-off

autohand traces status
autohand traces on
autohand traces off
autohand traces stop

ah traces status
ah traces on
ah traces off
ah traces stop

ahtraces status
ahtraces on
ahtraces off
ahtraces stop
```

The `autohand`, `autohand-code`, and `ah` aliases expose the same
`traces` subcommand. Use `off` to change consent, stop the daemon, and
remove derived local trace data. Use `stop` to stop the current daemon without
changing consent; Autohand can start it again on the next normal startup.

## Supported coding agents

The monitor has read-only adapters for 19 supported coding-agent harnesses:

1. Autohand
2. Claude Code
3. Cursor
4. OpenCode
5. OpenCode 2
6. Codex
7. Pi
8. Amp
9. GitHub Copilot
10. Cline
11. OpenClaw
12. Hermes
13. Droid
14. Grok
15. Kimi Code
16. Antigravity
17. Prime Agent
18. fx
19. DeepSeek Harness

The adapters inspect bounded, known session locations and normalize supported
JSON, JSONL, SQLite, and compressed JSONL records. Missing agent installations
are ignored.

## Inspect the local Work Map

The Work Map is rebuilt from local session records and makes no network request:

```bash
autohand discovery map --since 30d
autohand discovery map --agent autohand,codex --json
```

It contains aggregate session, tool, workflow, outcome, verification,
relationship, model, provider, reasoning-effort, and token-provenance signals.
It excludes prompts, responses, reasoning, commands, tool arguments and results,
source code, diffs, file paths, repository identities, session IDs, credentials,
and environment values.

## View traces in Autohand Console

1. Sign in with `autohand login` or `/login`.
2. Enable metadata sync with `autohand --traces-on`.
3. Run coding sessions in Autohand or another supported agent.
4. Open https://console.autohand.ai/traces.
5. If you belong to a Team, select the intended Team account in the Console
   account switcher.

The Traces page shows account-scoped session traces and a cross-agent summary by
harness, model, provider, and reasoning effort. Sync is incremental, so a new or
updated local session may take a short time to appear.

## Stop sync or delete cloud data

Turning tracing off stops future monitoring and sync, then removes Autohand's
derived local trace data:

```bash
autohand --traces-off
# Equivalent:
autohand traces off
ah traces off
ahtraces off
```

This does not delete data already uploaded. To remove your cloud trace data:

1. Open https://console.autohand.ai/account.
2. Find **Agent trace data**.
3. Select **Delete agent trace data**.
4. Type `DELETE TRACES` and confirm.

Deletion permanently removes trace metadata and any uploaded full trace content
created by your identity in the selected account. It does not remove other Team
members' traces or source session files owned by coding agents on your device.
Future traces continue to sync if monitoring remains on.

## Troubleshooting

- Run `ahtraces status` to confirm the companion is running.
- Run `autohand traces on` again after signing in if local monitoring works
  but Console data is missing.
- Confirm the correct personal or Team account is selected in Console.
- Reinstall with `install.sh` or `install.ps1` if `autohand` exists but
  `ahtraces` is missing.
- Use `autohand traces stop` for a temporary daemon restart without changing
  consent. Use `off` when you want monitoring and sync disabled.
