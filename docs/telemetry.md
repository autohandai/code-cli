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

New users choose a trace mode during onboarding. Existing configurations without
the current `traces.consentVersion` are asked once during an interactive startup;
cancelling leaves tracing off and asks again later. The stored choice can be
changed at any time:

```bash
autohand --traces-on       # local monitoring plus cloud metadata sync
autohand --traces-off      # stop monitoring/sync and remove derived local data
autohand traces status
autohand traces on         # also available as: ah traces on
autohand traces off        # also available as: ah traces off
ahtraces status
ahtraces on
ahtraces off
```

Use `/settings` when choosing local-only monitoring or the separately consented
full-content cloud mode.

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
messages, Grok to `summary.json`, `updates.jsonl`, and `chat_history.jsonl`,
Kimi to session state/wire files, and OpenClaw to agent session directories;
credential-shaped filenames are rejected before reading.
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

Copilot has two separate native contracts. For the CLI, the adapter reads only
`~/.copilot/session-state/<sessionId>/events.jsonl`; it does not open
`session.db`, `vscode.metadata.json`, `workspace.yaml`, checkpoints, or other
files beside the event stream. Version-1 events supply the native session ID,
CLI version, workspace/repository/branch/ref, timestamps, selected model,
reasoning effort, context-window limit, system/user/assistant text, readable
reasoning, paired tool calls/results, session errors and shutdown state. The
durable `session.shutdown.modelMetrics` ledger is authoritative for accumulated
per-model input, output, reasoning, cache-read and cache-write counts. Live
`assistant.usage` and compaction usage are used only when a shutdown ledger is
not available, so replayed accounting is not double-counted. `inputTokens`
remains the provider's total input count; cache counts are retained as its
reported sub-buckets and are not added again when deriving `total`.

The CLI normalizer intentionally excludes transformed prompts, attachments,
encrypted or opaque reasoning, request-correlation IDs, permission payloads,
hook payloads, skill contents, progress deltas and tool-specific telemetry.
Readable prompt, response, reasoning, tool arguments/results and error text are
still normalized trace content: they remain local in metadata mode and are
eligible for upload only after the separate full-content consent.
[GitHub's Copilot SDK event reference](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/streaming-events)
documents the event fields, and its
[usage guide](https://github.com/github/copilot-sdk/blob/main/docs/features/usage-and-billing.md)
distinguishes ephemeral per-call usage from accumulated session metrics.

For VS Code, the adapter reads only versioned chat snapshots under
`emptyWindowChatSessions` and `workspaceStorage/<workspace>/chatSessions`.
Versions 1 through 3 are supported. JSONL files are replayed as the official
initial/set/push/delete mutation log with safe path validation; unsent input
state, attachments, variables, citations, repository diffs and unrelated UI
state are not normalized. Non-empty sessions contribute user and assistant
text, readable thinking, tool calls/results, warnings, file-change paths,
timestamps and request model IDs. When available, `modelTotals` is preferred
over single-call prompt/completion counters because VS Code defines it as the
whole-turn total including subagents. Empty snapshots are not indexed, and
copied JSON/JSONL sessions deduplicate by native session ID. The storage paths,
versioned schema, and mutation format come from VS Code's
[chat session store](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/model/chatSessionStore.ts),
[serializable chat model](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/model/chatModel.ts),
and [object mutation log](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/model/objectMutationLog.ts).

A counts-only comparison against `@traces-sh/traces@0.6.30` used one installed
CLI session, one content-bearing VS Code snapshot, and one empty VS Code JSONL
snapshot without printing message content. Both implementations retained the
same two non-empty native session IDs and skipped the empty session. The pinned
reference produced four CLI events but left all token columns empty; Autohand
preserved the same conversation categories and additionally recovered the
durable model/token ledger. For the VS Code session, the reference produced 449
events: 175 assistant-text, 108 tool-call, 107 tool-result, 49 workspace-edit,
nine user-message, and one error event. Autohand matched those content/tool/edit
counts, while also retaining two serialized response-error records that the
reference omitted. Unknown CLI versions/events, VS Code versions, mutation
kinds, or response-part kinds mark coverage partial instead of silently
appearing complete.

Kimi wire protocols 1.4 and 1.5 join each agent's `wire.jsonl` with its
session `state.json`. The normalizer preserves main/subagent identity and
parent links, workspace and session timestamps, model/provider/thinking
configuration, user prompts, streamed text and reasoning, tool calls/results,
turn cancellation, compaction, and per-step input/output/cache usage. It
discards whitespace-only reasoning and does not double-count the duplicate
`step.end` and `usage.record` envelopes. A counts-only comparison of 95 local
wire traces matched the pinned Traces reference at 4,642 events and matched
all input/output/cache totals. The 60 observed protocol-1.0 traces remain
metadata-only and are explicitly partial; unknown future protocols and event
types also reduce coverage instead of appearing complete.

Droid session schema 2 joins each session JSONL with the exact sibling
`<session>.settings.json`. Only model, provider lock, and reasoning effort are
accepted from that settings file; other fields are never added to the trace.
The normalizer preserves native session identity, workspace and timestamps,
text/reasoning parts, tool calls/results, per-message usage and message-level
model attribution. It collapses adjacent native text blocks into the single
message event used by the reference and deduplicates copied files by native
session ID. A counts-only comparison of the installed Factory corpus matched
the pinned Traces reference at four trace IDs and seven events: three user
messages, two agent-text events, one tool call and one tool result. No token
usage was present in that corpus. Missing or future session schemas remain
readable but explicitly partial.

Grok sessions follow the [official session directory layout](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/17-sessions.md),
but the adapter reads only `summary.json`, the authoritative ACP
`updates.jsonl` stream, and `chat_history.jsonl` as a fallback when the update
stream has no conversation chunks. It does not open system prompts, plans,
feedback, hunk or rewind history, resource state, terminal logs, event logs,
signals, or subagent prompt metadata. Summary metadata supplies native identity,
workspace, Git state, model and timestamps. Streamed user, assistant and thought
chunks are coalesced; tool updates are joined by call ID; hook failures become
errors; and subagent spawns and fork/resume metadata become relationships without
reading the child prompt.

`turn_completed.usage` is treated as the authoritative per-turn ledger. The
adapter maps input, output, reasoning, cache-read, cache-creation and total token
fields, fills missing top-level splits from `modelUsage`, and deduplicates replayed
prompt IDs before summing. It intentionally does not treat
`signals.contextTokensUsed` as spend, and schema version 1 has no cost field for
`costUsdTicks`. A counts-only comparison used the same four-session Grok fixture
as `@traces-sh/traces@0.6.30`. The reference indexed only the content-bearing
parent and materialized ten events: five tool calls, three tool results and two
generic thinking events. Autohand retained all four native session identities;
the parent also had ten parts, classifying them as five calls, three results, one
user message and one hook error, while the other three remained metadata-only.
This validates the observed fixture and the intentional semantic difference,
not every Grok version or live append/restart behavior.

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
Trace ingestion and storage do not consume Autohand model/API usage quota.
Uploaded traces are visible at `https://console.autohand.ai/traces`. Stopping
cloud sync does not delete data already uploaded, and Console does not yet have
a trace-only deletion control. Deleting a personal account from the Account page
permanently removes its associated trace metadata and referenced full-content
objects.

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

Use `/settings` to review each switch. A completed consent choice writes
`traces.consentVersion`; the absence of the current marker prevents the daemon
and Work Map from running even if a legacy file says `traces.enabled: true`.
Disabling product telemetry stops new
events and network flushes but does not delete an existing local queue. Disabling
session sync does not delete its queued snapshots. Disabling trace cloud sync
leaves local Work Map processing enabled when `traces.enabled` remains true.
Disabling `traces.enabled` stops the companion and removes its derived local Work
Map and checkpoints; it never deletes the source histories owned by other agents.

For development and incident verification, inspect the queue files and use a
loopback API override or network capture. Deployment checks must still verify
the running API and Account deletion control rather than inferring production
state from repository code.
