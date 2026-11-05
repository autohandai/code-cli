# Built-in Squad messaging uses the running app's queues

Date: 2026-11-05

## Context

`/message` only addressed the active local CLI team, while `/squad` opened
or installed the app. Squad's external `send_message` started independent
Mission Control runs. Those paths could not select a desktop agent and send
a message into its actual direct conversation. The app already owns durable
message queues, saved agent permissions, transcripts, artifacts and memories.

## Decision

Add a session-owned Squad connection and a keyboard agent picker using the
existing Ink modal and input pause/resume hooks. A selected desktop agent
receives `/message <text>`; `/message team` explicitly addresses the existing
local team. Explicit `/message squad <agent-id>` is a one-off recipient.
IDs disambiguate duplicate names. Preserve top-level `autohand squad` app
launch and legacy standalone commands. No implicit app install/start is
performed when using the connection.

Bundle the Squad operator MCP schemas/runtime from `autohandai/squad`, with
MIT attribution and source revision, instead of requiring another package or
an installed app executable. Inject it into the runtime MCP list without
persisting or syncing it. Node/Bun source installs launch their entrypoint
with the current runtime; standalone binaries launch themselves directly.
Honor disabled MCP, opt-out, bare, offline and no-daemon behavior. Configured
Squad entries win. Managed member environment/connection markers prevent
operator access from being added to an agent already inside Squad.

Both slash commands and MCP use the same loopback bridge/tool implementation.
Direct sends enqueue in the actual member conversation; they preserve busy
work and paused queues, and return a durable receipt. The CLI sends no model,
engine or permission override. Library access is read-only. Existing normal
MCP discovery, permission checks and tool execution remain in the path.

## Evidence and limits

Focused command/MCP/installer/computer-use tests pass (41 tests), as do
type checking and lint. `tests/tuistory/squad-connection.tuistory.test.ts`
drives the built CLI through keyboard selection, direct delivery/history and
normal `tool_search`/`run_tool_script` invocation of the bundled MCP against
an isolated HTTP fixture. Squad's `scripts/check-control-plane.mjs` separately
checks actual bridge delivery and transcript persistence with a fake engine.
No live agent/provider is used as a test destination. Full `bun run proof`
is required before integration; its final result is recorded with the change.

`AUTOHAND_TEST_WORKERS=1 bun run proof` passed lint, type checking and all
965 executed unit files: 13,786 tests passed and 80 were skipped. Earlier
parallel runs exposed an old exact-context assertion (updated for the new
connection) and intermittent cancellation/file-lock deadlines in unchanged
tests. Those timing tests pass in isolation; the memory-index test also
passes on unchanged `main`. Their implementation and timeout budgets were
left intact. The serial run removes competing test workers without skipping
coverage; terminal proof follows the rebuilt CLI in the same command.

The complete terminal run executed 538 cases across 110 files: 532 passed,
four failed and two were skipped, so the overall proof command exited 1.
The orchestration-toggle and caret cases passed focused reruns; all 20
resize cases passed a full-file rerun. Console connector synchronization
failed again at `toolsListed > 0` on both this branch and an independently
built, unchanged `9d10d59d` checkout. The baseline orchestration file (11
cases), resize case and caret case passed. These results distinguish the
existing reproducible connector issue from intermittent terminal failures;
they do not establish that the full repository proof is green. No production
orchestration, resize, caret or Console-sync code was changed here.

The new Squad scenarios pass in both full-screen and standard layouts on
the built Node CLI and compiled macOS ARM64 CLI. Their explicit fixture
connection also passes with the terminal runner's default opt-out enabled.

Unit and terminal runners disable automatic Squad connections by default,
including scenarios that launch the CLI through a custom driver. The Squad
fixture explicitly opts back in against its isolated HTTP server, so generic
tests do not depend on an installed app or accidentally use its bridge.

The same Tuistory flow also passes with the compiled macOS ARM64 binary
(`AUTOHAND_SQUAD_TEST_BINARY`), including its automatic MCP self-launch.
Compiled stdio initialization/tool listing succeeds while the bridge is
offline with protocol-only stdout and 18 tools. A separate read-only roster
check against the installed Squad bridge recognized 18 members with presence;
it sent zero messages and made no app lifecycle calls. Local evidence is in
`.artifacts/squad-mcp/compiled-mcp-proof.json` and `live-readonly-proof.json`.

## Consequences

Desktop selection changes the unqualified `/message` recipient for this
session; the selection receipt documents the local-team escape and clearing
command. Selection is not persisted between sessions. There is no continuous
desktop roster polling or composer alias expansion in this change. A paused
queue requires a person in Squad. Send retries are not automatic/idempotent;
after a lost receipt inspect the queue before resending. Read history is
bounded to bridge chat turns; it does not load archived chat files or execute
artifact HTML. The vendored protocol needs deliberate synchronized updates;
no shared package or automatic Squad/CLI release is introduced.
