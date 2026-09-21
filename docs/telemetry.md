# Data collection, telemetry, and agent traces

> Last reviewed against the CLI source: 2026-09-21

Autohand has several independent data paths. Enabling one does not silently
enable the others. This document describes the client payloads and controls in
this repository; it does not make claims about a deployed service's retention,
logging, residency, or compliance policy.

## At a glance

| Data path | Default | Destination | Content |
| --- | --- | --- | --- |
| Version/usage check | On for ordinary non-bare startup | `POST /v1/version/check` | Stable device ID, CLI version, OS/architecture, client type |
| Product telemetry | Off | `POST /v1/telemetry` | Pseudonymous event envelope plus the event fields below |
| Cloud session sync | Off | `POST /v1/history` | Full saved session messages and session metadata |
| Automatic error reports | On unless declined | `POST /v1/reports` | Error message, path-sanitized stack, diagnostic context, device/runtime metadata |
| Local agent traces and Work Map | Off | Local files only | Agent session files parsed into a normalized trace, then an aggregate map |
| Cloud agent traces | Off | `POST /v1/traces/batch` | Metadata-only or separately consented bounded full trace content |

The HTTP service can observe normal connection metadata such as an IP address.
Nothing in this client repository proves how that transport metadata is logged
or retained by a deployed service.

## Product telemetry

Product telemetry is enabled only when `telemetry.enabled` is `true`. Every
event has this envelope:

- random event ID;
- persistent pseudonymous device ID from `~/.autohand/device-id`;
- current session ID;
- event timestamp and type;
- client type and client/CLI version;
- OS platform and release, Node version, CPU architecture and core count;
- total and free memory in MiB;
- running interaction count, distinct tool names, and error count.

The event-specific fields currently instrumented by the CLI are:

| Event | Fields |
| --- | --- |
| `session_start` | model, provider, provider display name/API format when present, reasoning effort, context window |
| `session_end` | status, duration, model/provider metadata |
| `tool_use` | tool name, success, duration, failure text, estimated result tokens, whether the result was truncated |
| `error` | error type, message, path-sanitized stack, context string |
| `session_failure_bug` | error name/message/stack, retry counters, conversation length, recent tool names, iteration/context usage, model/provider |
| `model_switch` | previous/new model, provider, provider metadata, reasoning effort, context window |
| `command_use` | command, known subcommand, surface (`interactive`, `cli`, `acp`, `json_rpc`, or `mobile`) |
| `heartbeat` | session uptime; emitted every 60 seconds while a telemetry-enabled session is active |
| `skill_use` | skill name/source, activation mode/action, span ID, token/byte size, version and file timestamps, release reason |
| `goal_event` | goal ID, lifecycle action, status/reason, source |
| `context_compaction` | token counts before/after, surviving skill span IDs, reason, cropped count |

The event schema also reserves `outcome` and `session_sync`. The current CLI has
no production call site emitting those as product-telemetry events; cloud
session sync uses the separate `/v1/history` request described below.

Command telemetry intentionally excludes free-form arguments, which can contain
prompts, paths, and server names. Product telemetry does not intentionally send
conversation messages, file contents, diffs, or tool arguments/results. It can,
however, contain free-form error/status strings. The current sanitizer removes
common user-home path prefixes from stacks; it is not a general PII or secret
detector. Treat error fields as potentially sensitive when deciding whether to
opt in.

Events are queued in `~/.autohand/telemetry/queue.json`, bounded to 500 entries,
and sent in batches of 20. The client checks `/health`, flushes every 60 seconds,
and retries failed sends up to three times. Unsent events remain in the local
queue. A graceful shutdown has a bounded best-effort flush.

## Cloud session sync

Cloud session sync is a second, content-bearing consent. It runs only when all
of these are true:

1. `telemetry.enabled` is `true`;
2. `telemetry.enableSessionSync` is `true`;
3. the user has an authenticated Autohand account token.

The payload contains the persistent device ID, session ID, every saved message's
role, full text content and timestamp, plus available metadata:

- model, provider, reasoning effort and context window;
- absolute workspace root, project name, session status, summary and title;
- client and client version;
- start/end timestamps and duration;
- additions and deletions;
- prompt, completion, cache and total token usage, turn count, usage provenance,
  longest-turn duration and usage timestamp.

Offline snapshots are stored in
`~/.autohand/telemetry/session-sync-queue.json`, bounded to the newest ten
sessions. An ephemeral run does not create or upload a session snapshot.

## Version check and automatic reports

These are separate from `telemetry.enabled`.

The version/usage check starts during ordinary CLI startup, sends immediately
when its 45-minute cache allows, and then checks on the same interval. Its body
contains `deviceId`, `currentVersion`, `platform` (OS and architecture), and
`clientType`; the version and device ID are also request headers. Bare mode does
not start it. `AUTOHAND_SKIP_PING=1` disables it for the process.

Automatic error reporting is enabled unless `autoReport.enabled` is `false`.
It sends the stable device ID, CLI version, platform, OS release, timestamp,
error type/message, a path-sanitized stack, and call-site diagnostic fields such
as model, provider, session ID, conversation length, recent tool names, retry
counters, context usage, or structured failure context. Reports are deduplicated
within a session and retried once. Path sanitization is not comprehensive secret
redaction, so this control should be reviewed separately from telemetry consent.

## Agent traces and Work Map

Agent traces are a separate local-first subsystem controlled by `traces.*`.
When `traces.enabled` is `false`, `ahtraces` is not kept running and Work Map
commands refuse to scan.

When enabled, the read-only adapters inspect known local session locations for
19 harnesses:

`autohand`, `claude-code`, `cursor`, `opencode`, `opencode2`, `codex`, `pi`,
`amp`, `copilot`, `cline`, `openclaw`, `hermes`, `droid`, `grok`, `kimi`,
`antigravity`, `prime-agent`, `fx`, and `deepseek`.

The adapters attempt to normalize native JSON, JSONL, SQLite, or compressed
JSONL records into schema version 1:

- source harness, native ID/path/fingerprint and agent version;
- project name/path and Git remote/branch/ref when the source exposes them;
- start/end time and status;
- model, provider, reasoning effort and context window;
- input/output/reasoning/cache/total token counts with provenance;
- parent, child, subagent, resume, fork and worktree relationships;
- ordered user/assistant/system/tool messages;
- text, reasoning, tool call/result, error, file-change and terminal parts;
- derived outcome state, evidence facts and confidence;
- parser version, completeness and warnings.

Cursor's global SQLite path can be overridden with `TRACES_CURSOR_GLOBAL_DB`
for a mounted host database. Copilot scanning includes CLI sessions and VS Code
workspace and empty-window chat stores.

Registry coverage is not the same as native-version parity. OpenCode SQLite
`session`/`message`/`part` records and OpenCode 2 `session_message` records use
separate readers so shared databases do not double-count sessions. Those readers
select only trace columns; they do not query account, credential, or share-secret
tables. OpenCode's legacy JSON scan is limited to session/message/part storage
directories, not the data root containing `auth.json`. Token counts are read
only from explicit usage envelopes, never inferred from tool arguments or
results. SQLite WAL changes trigger a rescan and WAL size counts toward the
source budget. Legacy OpenCode JSON joins, authentic native-version fixtures
for the remaining harnesses, and OpenCode 2's service-API fallback remain
release gates.

The registry now selects known session stores rather than application roots for
Pi, Amp, Copilot, Cline, Grok, Kimi, Prime Agent, Hermes, DeepSeek, Codex, and
Cursor. The walker limits VS Code workspace storage to `chatSessions`, Copilot
CLI to `events.jsonl`, Cline to task history files and versioned SDK session
messages, Kimi to session state/wire files, and OpenClaw to agent session
directories; credential-shaped filenames are rejected before reading.
Decoy-file tests cover these paths. This reduces accidental configuration
reads, but it is not proof of complete or future-safe
native parsing. Each upstream version still needs an authentic session fixture
and a source-minimization review before a production opt-in rollout.

For Cline's [SDK messages contract v1](https://github.com/cline/cline/blob/main/sdk/packages/core/docs/messages-contract-v1.md),
the adapter reads the matching `<sessionId>.json` manifest and
`<sessionId>.messages.json` under each session directory, including a
`CLINE_DATA_DIR` override. It joins status/workspace metadata with per-message
model and token metrics, rejects unknown contract versions as partial coverage,
and counts nested messages against the scan record budget. Older Cline task
history still needs a native join.

Pi session-v3 JSONL uses a native normalizer for session identity/version,
workspace and timestamps, model and thinking-level changes, per-message model
and token/cache/reasoning usage, text/reasoning blocks, camel-case tool calls,
paired tool results, errors and compaction events. Whitespace-only blocks are
discarded. Unknown Pi versions, record types, content types or roles mark the
source partial instead of silently producing complete-looking usage. A
counts-only comparison of 26 installed Pi sessions matched the pinned Traces
reference at 651 normalized events, including the per-event-type split; no
session content was printed or copied. This validates the observed v3 corpus,
not every past or future Pi format.

A single harness scan is bounded to 5,000 files, 64 MiB per file, 64 MiB total,
100,000 records and directory depth 12. Work Map scans at most three harnesses
concurrently by default. Truncation and parse failures are surfaced as coverage
warnings instead of being presented as complete data.

The persistent local index does not retain raw message content. It replaces
native/session/repository identities with opaque hashes, reduces tool calls to
categories, keeps only error/exit evidence and bounded per-model token summaries
needed for aggregates, and writes an aggregate Work Map and checkpoints under
`~/.autohand/traces/` (or the configured Autohand home). Work Map output
contains counts and dimensions for sessions, duration, token provenance,
harness/model/provider/reasoning effort, tool categories, workflow motifs,
outcomes, verification evidence, relationships, repository counts and bounded
recommendations. It explicitly excludes prompts, responses, reasoning, commands,
tool arguments/results, code/diffs, paths, repository identities, session IDs,
credentials, and environment values.

Where message-level usage exists, the local Work Map attributes tokens to each
message's model. Tokens without reliable model attribution appear as
`unattributed` rather than being assigned to the first model in the session.
Existing local checkpoints are rescanned once for this index upgrade. The
cloud metadata endpoint still receives trace-level model totals; per-model
cloud billing breakdown for mixed-model sessions remains a release gate.

`autohand discovery map` performs a fresh bounded local scan and makes no network
request. The agent's `inspect_work_map` tool reads the same aggregate model. Both
require `traces.enabled: true`; set `traces.discoveryMap: false` to prevent map
access while leaving monitoring available for an explicitly chosen cloud mode.

### Optional cloud traces

Cloud trace upload additionally requires `traces.cloudSync: true` and an
authenticated account. Uploads are incremental, at most 50 traces and 4 MiB per
HTTP request, and the server must acknowledge every requested trace exactly once.
Each request also sends schema version 1 and the persistent pseudonymous device
ID; authentication associates accepted rows with the active account and user.

`traces.contentMode: "metadata"` sends:

- canonical trace ID, hashed native ID and source fingerprint;
- harness and agent version;
- timestamps, status, model/provider/reasoning/context window;
- token usage, relationships and derived outcome facts.

It does not send project metadata or messages. `"full"` adds normalized messages
and parts. Before upload, IDs are made opaque, common credential patterns and
secret-named object fields are redacted, home paths are replaced, strings and
object depth are bounded, message content has a 1 MiB budget, and each serialized
trace is capped at 3 MiB before it can enter a 4 MiB request. This is defense in
depth, not a guarantee that arbitrary source code, personal data, or an unknown
secret pattern cannot remain. Full mode therefore requires a distinct explicit
choice.

## Configuration

The privacy-preserving defaults are:

```json
{
  "telemetry": {
    "enabled": false,
    "enableSessionSync": false
  },
  "traces": {
    "enabled": false,
    "cloudSync": false,
    "contentMode": "metadata",
    "discoveryMap": true
  },
  "autoReport": {
    "enabled": true
  }
}
```

Use `/settings` to review each switch. Disabling product telemetry stops new
events and network flushes but does not delete an existing local queue. Disabling
session sync does not delete its queued snapshots. Disabling trace cloud sync
leaves local Work Map processing enabled when `traces.enabled` remains true.
Disabling `traces.enabled` stops the companion and removes its derived local Work
Map and checkpoints; it never deletes the source histories owned by other agents.

For development and incident verification, inspect the queue files and use a
loopback API override or network capture. Do not infer deployed retention or
deletion behavior from the client implementation; verify those policies against
the running API and account controls.
