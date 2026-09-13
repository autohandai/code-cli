# 20 implementable Codex and Claude Code gaps

Reviewed: 2026-09-05. Revised: 2026-09-13 (second revision).

At the original review, the Autohand worktree supported **11 of these capabilities partially** and lacked **9 as native capabilities**. As of the second revision (updated on 2026-09-13 and 2026-09-14 as items 3, 4, 10, 13, and 17 landed), **8 are implemented** (items 2, 3, 4, 5, 10, 13, 14, and 17), **6 are partial**, and **6 are missing**. Codex did not stand still: one stable release and roughly 380 main-branch commits landed since the pin, and they touched twelve of the twenty items. The proposals below focus on the remaining behavior, rather than counting differently named equivalents as absent.

## Evidence and scope

- Compared the current CLI registrations, runtime, permission system, sessions, MCP client, output writer, tests, and package surface against [CLAUDE_CODE_GAPS.md](CLAUDE_CODE_GAPS.md).
- Autohand audit began at `f708cbdcfc32939533b023466b86e2162f04e186`. Other work continued concurrently; HEAD at report assembly was `0e6dc99f80f946b1aae15cb3ef406cc0a1bb27d3`, with additional uncommitted changes. Findings include the implementation present in that worktree, including lifecycle-hook and session work.
- The second revision re-checked every item against Autohand HEAD `4336efd9` (2026-09-13, clean tree) by reading the owning code, not by re-running the original comparison from scratch. Status changes are listed under [What changed since the first review](#what-changed-since-the-first-review).
- Codex main was originally pinned at [`ddf04ad26789`](https://github.com/openai/codex/commit/ddf04ad26789d040f9ef6a96736f76602e35a6cc). Selected source files were retrieved at that exact commit; links below distinguish those from current official documentation. The second revision observed main at [`ee6814bfa488`](https://github.com/openai/codex/commit/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8) (2026-09-12) and summarizes the drift per item; it did not re-read Codex source for unchanged items.
- The latest release observed at the first review was [`rust-v0.153.4`](https://github.com/openai/codex/releases/tag/rust-v0.153.4). At the second revision the latest stable release was [`rust-v0.154.0`](https://github.com/openai/codex/releases/tag/rust-v0.154.0) (2026-09-09), with `rust-v0.155.0-alpha.3.10` in prerelease. Release notes for the alphas are empty, so anything attributed to "main" below is inferred from merged pull requests and may not be in a released client.
- “Claude doc” means the supplied August 3 comparison, rechecked against local Autohand code. This audit did not independently re-audit a current Claude binary.
- Scope is the native capabilities and package surface in this repository. An external MCP server, custom extension, shell script, or package in another repository may provide an alternative.
- This is a feature assessment and implementation backlog. Production code and dependencies were not changed. The original Claude comparison was preserved.

## Recommended backlog

The order balances everyday usefulness, reuse of existing modules, and strategic gaps. Size is a relative engineering estimate, not a delivery promise: S = focused integration; M = several runtime/UI seams; L = substantial protocol or platform work; XL = a platform program.

| # | Capability to implement | Current status | Comparison basis | Size |
| --- | --- | --- | --- | --- |
| 1 | [Schema-validated command results](#1-schema-validated-command-results) | Partial | Both | M |
| 2 | [Resume latest session and CLI session picker](#2-resume-latest-session-and-cli-session-picker) | Implemented | Both | S |
| 3 | [Tool allowlists and denylists at launch](#3-tool-allowlists-and-denylists-at-launch) | Implemented | Claude doc | M |
| 4 | [Ephemeral full-agent sessions](#4-ephemeral-full-agent-sessions) | Implemented | Both | M |
| 5 | [Named local run profiles and temporary config overrides](#5-named-local-run-profiles-and-temporary-config-overrides) | Implemented | Codex | M |
| 6 | [OAuth login for remote MCP servers](#6-oauth-login-for-remote-mcp-servers) | Missing | Codex | L |
| 7 | [OS-enforced command sandbox](#7-os-enforced-command-sandbox) | Missing | Codex | XL |
| 8 | [Enforced network egress policy](#8-enforced-network-egress-policy) | Missing | Codex | L |
| 9 | [Organization-enforced security policy](#9-organization-enforced-security-policy) | Partial | Codex | L |
| 10 | [Controlled subprocess environment inheritance](#10-controlled-subprocess-environment-inheritance) | Implemented | Codex | M |
| 11 | [Persistent terminals the model can interact with](#11-persistent-terminals-the-model-can-interact-with) | Partial | Codex | M |
| 12 | [First-class TypeScript SDK over existing RPC](#12-first-class-typescript-sdk-over-existing-rpc) | Partial | Codex | M |
| 13 | [User-named, searchable sessions](#13-user-named-searchable-sessions) | Implemented | Both | S |
| 14 | [Start directly in plan mode](#14-start-directly-in-plan-mode) | Implemented | Claude doc | S |
| 15 | [Budgets for every normal agent run](#15-budgets-for-every-normal-agent-run) | Partial | Claude doc | M |
| 16 | [User-configured ordered model fallback](#16-user-configured-ordered-model-fallback) | Missing | Claude doc | M |
| 17 | [Installation and runtime doctor](#17-installation-and-runtime-doctor) | Implemented | Claude doc | M |
| 18 | [Screen-reader-friendly interactive terminal mode](#18-screen-reader-friendly-interactive-terminal-mode) | Missing | Claude doc | M |
| 19 | [MCP elicitation and interactive server requests](#19-mcp-elicitation-and-interactive-server-requests) | Missing | Codex | M |
| 20 | [Native image generation and editing](#20-native-image-generation-and-editing) | Missing | Codex | L |

Items **2, 3, 4, 5, 10, 13, 14, and 17** are implemented. Continue with **1** for the first delivery sequence: they build on existing output, session, permission, and config infrastructure. Plan **7–10** together as the execution-security milestone; network restrictions need real enforcement, and managed policy must survive CLI and runtime overrides. Prioritize **6, 12, and 19** when integration adoption is the immediate goal; Codex moved on all three since the pin, so the distance is growing there rather than shrinking.

## Implementation detail

### 1. Schema-validated command results

**Current evidence:** `--json local` already writes one JSON result, but its `content` is text. Strict schemas exist only in the restricted, tool-free Blueprint RPC flow. Owning code: [src/modes/commandOutput.ts:30](../src/modes/commandOutput.ts#L30), [src/modes/rpc/blueprintAnswer.ts:149](../src/modes/rpc/blueprintAnswer.ts#L149), [src/types.ts:1259](../src/types.ts#L1259).

**Comparator:** [Codex output-schema option](https://github.com/openai/codex/blob/ddf04ad26789d040f9ef6a96736f76602e35a6cc/codex-rs/exec/src/cli.rs#L47). The exec CLI accepts a final-response JSON Schema; this is more than a JSON transport envelope.

**Implementation:** Add a command-mode output-schema option, pass supported schemas through providers, and validate the final result locally. Reject invalid output with a structured error and nonzero exit status.

**Acceptance:** Extend `tests/commandOutput.spec.ts`, provider contract tests, and a CLI Tuistory scenario; cover invalid schemas, unsupported providers, malformed output, cancellation, and stdout purity.

### 2. Resume latest session and CLI session picker

**Status:** Implemented. `autohand resume` opens the current project's picker; `--last` selects the most recently active session; `--all` includes every project and can be combined with `--last`. `--path` selects a workspace. Explicit IDs, unique prefixes, and saved session paths remain supported; `-c` remains auto-commit. The picker pages through older history and cancels with Escape or Ctrl+C without starting an agent.

**Owning code:** [CLI registration](../src/startup/resumeCommand.ts), [shared picker](../src/commands/resume.ts), and [session lookup](../src/session/SessionManager.ts). Latest-session selection falls back to creation time for legacy or invalid activity timestamps. Project filtering matches filesystem aliases, including macOS `/var` and `/private/var` paths.

**Comparator:** [Codex resume CLI](https://learn.chatgpt.com/docs/developer-commands?surface=cli#codex-resume). The original comparison identified picker and cwd-scoped --last/--all behavior.

**Validation:** 121 focused unit/render tests and 10 compiled-CLI Tuistory scenarios passed, including screen snapshots, project filtering, latest activity, paging, cancellation, empty history, and ambiguous references. Build, lint, and typecheck passed. Aggregate proof remains incomplete: the unit run reported failures/timeouts, whose two affected files passed all 45 tests separately; the full terminal-suite attempt was stopped without a completion summary. See [startup tests](../tests/startup/resumeCommand.test.ts), [session tests](../tests/session/SessionManager.test.ts), and [terminal scenarios](../tests/tuistory/resume.tuistory.test.ts).

### 3. Tool allowlists and denylists at launch

**Status:** Implemented on 2026-09-13. `--allowed-tools <patterns>` and `--disallowed-tools <patterns>` accept comma-separated or repeated tool patterns in the existing `name` / `name(argument)` syntax. They form a run-only scope installed on the permission manager by the agent composer, so every launch mode that builds an agent honours it (interactive, command, RPC, ACP, auto-mode). The scope is checked before any merged policy, is never written to the config, and cannot be widened by a local or extension allowlist. It is matched on the tool the model names, before capability mapping, at two points: the tool manager rejects the call, and the permission manager refuses the mapped context. Excluded tools are removed from the schemas advertised to the model and to delegated agents, MCP tools included; a pattern with an argument keeps the tool advertised and narrows calls only. Owning code: [run scope](../src/permissions/runToolScope.ts), [tool manager gate](../src/core/toolManager.ts), [`PermissionManager`](../src/permissions/PermissionManager.ts), [composer wiring](../src/core/agent/AgentDependencyComposer.ts). Validation: [unit](../tests/permissions/toolAdvertising.spec.ts) including a fabricated `delete_path` call in unrestricted mode, and a built-CLI Tuistory scenario that inspects the tool schemas the mock provider receives. An independent review with Codex found the first version bypassable through capability mapping, policy union, and persisted config; all three were closed the same day.

**Original evidence:** Permission settings already expose `availableTools`, `excludedTools`, allow/deny patterns, and a tool filter. The CLI lacked a direct per-run surface. Owning code: [src/permissions/types.ts:18](../src/permissions/types.ts#L18), [src/permissions/PermissionManager.ts:584](../src/permissions/PermissionManager.ts#L584), [src/core/toolFilter.ts:40](../src/core/toolFilter.ts#L40), [src/index.ts:238](../src/index.ts#L238).

**Comparator:** [Claude comparison: permission and tool scoping](CLAUDE_CODE_GAPS.md#permissions--tool-scoping). Candidate carried forward from the supplied Claude comparison; no claim that Codex exposes identical flags.

**Implementation:** Add long CLI options for allowed, denied, and exposed tools. Apply them to both advertised schemas and execution authorization, including dynamically discovered MCP and delegated tools.

**Acceptance:** Extend permission/tool-filter tests and add help/startup Tuistory coverage; ensure exclusions still apply after MCP refresh and that a fabricated tool call cannot bypass them.

### 4. Ephemeral full-agent sessions

**Status:** Implemented on 2026-09-14. `autohand --ephemeral` runs a normal tool-using session whose transcript, metadata, state, and usage live in memory only: no session directory, no index entry, no automatic memory extraction, no session sync, while workspace files the agent writes are unaffected. It is refused together with `--resume` or `--fork`. RPC forwards the flag; ACP passes it through its runtime options. Owning code: [session manager](../src/session/SessionManager.ts), [composer](../src/core/agent/AgentDependencyComposer.ts), [flag](../src/index.ts). Validation: [unit](../tests/session/ephemeralSessions.test.ts) proving a full lifecycle leaves the sessions directory absent and a shared index untouched, plus a built-CLI Tuistory command-mode run.

**Original evidence:** Normal sessions create directories, save metadata, and update the index. `--bare` still initializes sessions; Blueprint's tool-free RPC profile already avoids session persistence. Owning code: [src/session/SessionManager.ts:109](../src/session/SessionManager.ts#L109), [src/core/agent/AgentLifecycleRunner.ts:717](../src/core/agent/AgentLifecycleRunner.ts#L717), [src/modes/rpc/types.ts:88](../src/modes/rpc/types.ts#L88).

**Comparator:** [Codex ephemeral exec option](https://github.com/openai/codex/blob/ddf04ad26789d040f9ef6a96736f76602e35a6cc/codex-rs/exec/src/cli.rs#L35). Codex promises no persisted session files here, not zero writes of every kind. The proposed Autohand memory/sync contract is an explicit product choice.

**Implementation:** Offer an in-memory persistence mode for normal tool-using runs. Define its transcript, memory-extraction, and sync behavior explicitly; keep intentionally created workspace files working.

**Acceptance:** Use isolated-home integration tests for normal completion, errors, Ctrl+C, and tool use; assert no session transcript, index entry, automatic memory, or session-sync payload is produced.

### 5. Named local run profiles and temporary config overrides

**Status:** Implemented on 2026-09-14. `profiles.<name>` in the config holds a partial config; `--profile <name>` layers it onto the run, and repeatable `--set key=value` overrides individual settings by dotted path with JSON-or-text values. Precedence is file, workspace overlays, environment, profile, then `--set`. Both layers are recorded at load time and a save during the run restores the file's own values under every layered path unless the user changed that setting during the run, so `/model` still persists a deliberate choice while the profile never leaks into the file. Neither layer may touch `auth` or `profiles`; an unknown profile stops startup and lists the defined names. The selection is installed by a command hook, so every subcommand and every config load in the process sees it. Owning code: [run overlay](../src/runConfigOverlay.ts), [loader and saver](../src/config.ts), [flags](../src/index.ts), [docs](config-reference.md#profiles-and-one-run-overrides). Validation: [unit](../tests/config/runConfigOverlay.test.ts) including a load-then-save round trip, and a built-CLI Tuistory scenario through `autohand doctor --json`.

**Original evidence:** Global/workspace/environment layering and account default-profile sync exist. There is no local named profile selector or generic non-persisted key/value override. Owning code: [src/config.ts:501](../src/config.ts#L501), [src/sync/CodingAgentControlPlane.ts:329](../src/sync/CodingAgentControlPlane.ts#L329), [src/index.ts:255](../src/index.ts#L255).

**Comparator:** [Codex profiles and overrides](https://learn.chatgpt.com/docs/config-file/config-advanced#profiles). Current Codex uses separate named profile files and one-run config overrides. Autohand can preserve its existing config formats and flag meanings.

**Implementation:** Add named profiles and repeatable long-form overrides for model, permissions, tools, and UI settings, with documented precedence and no automatic config writes. Keep `--config` as a file path and `-c` as auto-commit.

**Acceptance:** Extend config/profile tests for precedence, invalid keys, nested values, no persistence, and later managed-policy enforcement.

### 6. OAuth login for remote MCP servers

**Current evidence:** MCP HTTP supports caller-supplied headers but has no OAuth discovery/login/refresh/logout lifecycle. Autohand account and model-provider authentication are separate capabilities. Owning code: [src/mcp/types.ts:18](../src/mcp/types.ts#L18), [src/mcp/McpClientManager.ts:534](../src/mcp/McpClientManager.ts#L534), [src/mcp/McpClientManager.ts:1234](../src/mcp/McpClientManager.ts#L1234).

**Comparator:** [Codex MCP OAuth implementation](https://github.com/openai/codex/blob/ddf04ad26789d040f9ef6a96736f76602e35a6cc/codex-rs/rmcp-client/src/perform_oauth_login.rs#L91). First-party OAuth login implementation; the official MCP docs also describe registration, scopes, and callbacks.

**Implementation:** Add per-server OAuth discovery and authorization with PKCE, secure token storage, refresh, and explicit login/logout commands. Preserve direct-header configuration.

**Acceptance:** Use mock authorization/MCP servers for challenge discovery, callback/state checks, expiry/refresh, denial, revocation, and redacted errors; verify the browser-to-terminal handoff.

### 7. OS-enforced command sandbox

**Current evidence:** Tool authorization, workspace checks, and worktrees exist; shell execution still delegates to host processes without an OS isolation backend. Owning code: [src/actions/command.ts:149](../src/actions/command.ts#L149), [src/ui/shellCommand.ts:893](../src/ui/shellCommand.ts#L893), [src/permissions/PermissionManager.ts:584](../src/permissions/PermissionManager.ts#L584).

**Comparator:** [Codex platform sandbox manager](https://github.com/openai/codex/blob/ddf04ad26789d040f9ef6a96736f76602e35a6cc/codex-rs/sandboxing/src/manager.rs#L67). Source selects macOS, Linux, and Windows backends. Platform support and settings still govern enforcement; worktree isolation is a different capability.

**Implementation:** Introduce platform execution backends with read-only and workspace-write policies, exact escalation requests, and explicit unsupported-platform behavior. Apply the policy to every covered child-process path.

**Acceptance:** Run real platform escape probes for writes outside allowed roots, symlinks, child processes, redirects, and approvals; unit mocks cannot establish sandbox enforcement.

### 8. Enforced network egress policy

**Current evidence:** Autohand has URL/tool permission patterns and an offline-startup flag, but neither constrains the network access of an arbitrary approved shell process. Owning code: [src/permissions/types.ts:41](../src/permissions/types.ts#L41), [src/index.ts:247](../src/index.ts#L247), [src/actions/command.ts:149](../src/actions/command.ts#L149).

**Comparator:** [Codex network requirements](https://learn.chatgpt.com/docs/config-file/config-reference). The documented experimental_network namespace includes domain rules and administrator-only allowlists for sandboxed commands. It does not automatically cover web search, apps, or MCP traffic; retain the experimental qualification.

**Implementation:** Add enforced domain/network allow-and-deny rules with per-request approvals, backed by a proxy and/or sandbox. Specify separate policies for inference, MCP, and executed commands.

**Acceptance:** Probe allowed and denied hosts through direct sockets, DNS, redirects, proxies, and descendant processes. Demonstrate that shell networking cannot bypass the configured policy.

### 9. Organization-enforced security policy

**Current evidence:** Account profiles and managed connector synchronization provide distribution, but normal config merges and profile application do not create a non-overridable security-policy layer. Owning code: [src/config.ts:501](../src/config.ts#L501), [src/sync/CodingAgentControlPlane.ts:312](../src/sync/CodingAgentControlPlane.ts#L312), [src/sync/CodingAgentControlPlane.ts:342](../src/sync/CodingAgentControlPlane.ts#L342).

**Comparator:** [Codex administrator requirements](https://learn.chatgpt.com/docs/enterprise/managed-configuration#admin-enforced-requirements-requirementstoml). Administrator requirements constrain effective client settings. Cloud distribution has its own account availability; the proposal can begin with a local administrator-owned policy.

**Implementation:** Load administrator-owned constraints for approval modes, providers, filesystem/network access, and MCP servers. Validate user, project, CLI, and runtime changes against those constraints and explain conflicts.

**Acceptance:** Attempt weakening the policy through config, CLI flags, RPC settings, extensions, and dynamically loaded MCP tools; cover invalid and unavailable policy sources.

### 10. Controlled subprocess environment inheritance

**Status:** Implemented on 2026-09-13. `shell.env` in the config takes `inherit` (`all`, `essential`, `none`), `include` and `exclude` name globs, and `set` for pinned values; invalid shapes fail config loading with the field named. The policy is installed when the config loads and applied by the shared child-environment helper, which covers the `run_command` tool, `!` commands, streaming and interactive shells, lifecycle hook commands, and stdio MCP servers (a server's own `env` still wins). Autohand's own runtime variables are always present. Owning code: [policy](../src/utils/childProcessEnv.ts), [validation](../src/config.ts), [hooks](../src/core/HookManager.ts), [MCP](../src/mcp/McpClientManager.ts), [docs](config-reference.md#shell-settings). Validation: [pure policy tests](../tests/utils/childProcessEnv.test.ts), a real child-process check in [command tests](../tests/command.spec.ts), [hook](../tests/hookManager.spec.ts) and [MCP](../tests/mcp/stdioConnectionEnv.test.ts) spawn checks, and [config validation](../tests/config/shellSettings.test.ts).

**Original evidence:** The shared child environment helper copied the full base environment before applying overrides. It did not expose an inheritance allowlist or exclusion policy. Owning code: [src/utils/childProcessEnv.ts:21](../src/utils/childProcessEnv.ts#L21), [src/actions/command.ts:150](../src/actions/command.ts#L150), [src/mcp/McpClientManager.ts:141](../src/mcp/McpClientManager.ts#L141).

**Comparator:** [Codex shell environment policy](https://learn.chatgpt.com/docs/config-file/config-advanced#shell-environment-policy). Codex documents inheritance and filters. Automatic filtering of secret-looking names is not its default; the opportunity is explicit control of child environments.

**Implementation:** Add inherit-all/essential/none modes, include/exclude patterns, and explicit overrides. Route relevant shell, PTY, hook, and MCP launchers through a documented policy while preserving required runtime variables.

**Acceptance:** Use harmless sentinel credentials to verify filtering in real child processes; check precedence, Windows key casing, PATH handling, and explicitly authorized credentials.

### 11. Persistent terminals the model can interact with

**Current evidence:** Node-PTY shell execution and a background PID registry already exist. The model has no live terminal handle API for writing input and polling later output. Owning code: [src/ui/shellCommand.ts:891](../src/ui/shellCommand.ts#L891), [src/core/agent/BackgroundProcessRegistry.ts:8](../src/core/agent/BackgroundProcessRegistry.ts#L8), [src/core/toolManager.ts:1](../src/core/toolManager.ts#L1).

**Comparator:** [Codex model-callable stdin handler](https://github.com/openai/codex/blob/ddf04ad26789d040f9ef6a96736f76602e35a6cc/codex-rs/core/src/tools/handlers/unified_exec/write_stdin.rs#L23). The handler takes a live session ID and input. Unified exec and PTY allocation are marked Stable/default-enabled in the inspected feature registry, subject to runtime settings.

**Implementation:** Expose execution handles plus input/poll operations with bounded output, cancellation, exit status, and stale-handle protection. Reuse the current PTY execution infrastructure.

**Acceptance:** Add a real PTY scenario that starts a REPL, sends multiple inputs, retrieves incremental output, interrupts execution, and rejects input after exit.

### 12. First-class TypeScript SDK over existing RPC

**Current evidence:** RPC already supports prompts, acknowledgments, streaming updates, cancellation, permissions, and configuration controls. This repository packages CLI binaries, without a public typed client library. Owning code: [src/modes/rpc/types.ts:209](../src/modes/rpc/types.ts#L209), [src/modes/rpc/adapter.ts:557](../src/modes/rpc/adapter.ts#L557), [tests/sdkControlRpc.spec.ts:16](../tests/sdkControlRpc.spec.ts#L16), [package.json:20](../package.json#L20).

**Comparator:** [Codex TypeScript SDK](https://github.com/openai/codex/blob/ddf04ad26789d040f9ef6a96736f76602e35a6cc/sdk/typescript/README.md#L17). The public package exposes thread start/resume, streamed events, and per-turn output schemas. Autohand's existing RPC is the foundation for a client package.

**Implementation:** Package a client with session/run APIs, typed async events, approval callbacks, abort signals, subprocess cleanup, and protocol compatibility checks. Reuse RPC rather than creating another execution runtime.

**Acceptance:** Drive the compiled CLI through the public client; cover multiple turns, early acknowledgement, streaming, cancellation, malformed frames, server exit, and version mismatch.

### 13. User-named, searchable sessions

**Status:** Implemented on 2026-09-13. Session metadata carries an explicit `title` with a `titleSource` of `user` or `auto`. `/rename <name>` names the current session; `autohand --rename <name>` names the most recent session of the workspace from a script and exits. Unnamed sessions are named from the first instruction and refined once by the model after the first answer; a user-chosen name is never replaced. `/sessions` shows a Name column, `/session` shows the name, and the terminal window title carries the name with a working, waiting-for-input, or idle marker and is restored on exit.

**Owning code:** [session metadata](../src/session/types.ts#L73), [rename](../src/session/SessionManager.ts#L366), [title rules](../src/session/sessionTitle.ts#L11), [auto-naming](../src/core/agent/SessionAutoNamer.ts#L20), [terminal title](../src/ui/terminalTitle.ts#L47), [`/rename`](../src/commands/rename.ts), [`--rename`](../src/index.ts#L334).

**Resume by name:** `autohand resume <reference>` and `/resume <reference>` resolve a saved name case-insensitively after exact ID and path lookups and before ID-prefix matching, so a chosen name wins over a typed prefix. A name shared by several sessions is rejected with their ID prefixes listed ([reference resolution](../src/session/SessionManager.ts#L171)). Codex resolves unique session labels ([#43315](https://github.com/openai/codex/pull/43315)) and improved automatic thread naming ([#42749](https://github.com/openai/codex/pull/42749)) since the pin.

**Validation:** Unit tests for title normalization, rename, auto-naming, terminal-title formatting, and name resolution ([resolver tests](../tests/session/resolveSessionByName.test.ts)), plus built-CLI Tuistory scenarios for `/rename`, `/sessions`, `--rename`, resume by name, and the title markers pass on the compiled dist ([rename tests](../tests/commands/rename.test.ts), [title tests](../tests/core/agent/AgentSessionTitle.test.ts), [terminal scenarios](../tests/tuistory/built-cli.tuistory.test.ts)).

### 14. Start directly in plan mode

**Current evidence:** `autohand --plan` starts interactive and command runs in planning mode before the first model request. The initial composer shows `[PLAN]`, the model receives planning instructions and read-only tools, and mutating tool calls are rejected by the existing tool gate. `/plan on|off` and Shift+Tab remain available. Owning code: [src/core/agent.ts](../src/core/agent.ts), [src/core/agent/AgentCommandRuntime.ts](../src/core/agent/AgentCommandRuntime.ts), [src/index.ts](../src/index.ts).

**Comparator:** [Claude comparison: permission and tool scoping](CLAUDE_CODE_GAPS.md#permissions--tool-scoping). Candidate carried forward from the supplied Claude comparison; no claim that Codex exposes identical flags.

**Implementation:** The startup flag uses the existing interaction-mode controller and starts a fresh planning phase. It conflicts with `--yolo`, `--auto-mode`, and `--auto-commit`. Interactive acceptance requires an explicit user decision even with `--yes` or `--unrestricted`; command and unattended runs leave the plan pending review. The `--mode rpc|acp` transport selector remains separate.

**Acceptance:** 229 focused tests and eight built-CLI Tuistory scenarios pass, covering the initial prompt, first-request tool filtering, rejected writes, command-mode planning, declined interactive acceptance, keyboard mode switching, conflicts, and help. After the installer/hook CI repairs, full `bun run proof` passes in an isolated checkout: 9,031 unit tests and 139 terminal tests, plus lint, typecheck, and build. The isolated run excludes unrelated working changes.

### 15. Budgets for every normal agent run

**Current evidence:** `--max-cost` and runtime enforcement are wired to standalone auto-mode. Persistent goals have their own budgets; ordinary command and interactive turns lack an equivalent shared cost limit. Owning code: [src/core/AutomodeManager.ts:294](../src/core/AutomodeManager.ts#L294), [src/types.ts:1055](../src/types.ts#L1055), [src/core/agent/AgentSessionAccounting.ts:20](../src/core/agent/AgentSessionAccounting.ts#L20).

**Comparator:** [Claude comparison: headless budgets](CLAUDE_CODE_GAPS.md#headless--sdk-protocol). The supplied document identifies the command-mode budget gap. This is not being attributed to a Codex dollar-budget flag.

**Implementation:** Introduce shared cost/time/turn budget accounting across the main run and delegated work. Return a typed budget-exhausted result and preserve progress; define behavior when a provider omits usage or price data.

**Acceptance:** Cover normal CLI and RPC paths, cumulative subagent usage, retries, missing usage data, and stopping before an additional model request. Do not promise a mathematically exact dollar cap for unpriced in-flight usage.

### 16. User-configured ordered model fallback

**Current evidence:** Provider configuration has default-model recovery, but no user-defined ordered failure chain. The gap document's cited fallback location now concerns removing a custom provider, not runtime failover. Owning code: [src/core/agent/ProviderConfigManager.ts:2487](../src/core/agent/ProviderConfigManager.ts#L2487), [src/types.ts:975](../src/types.ts#L975).

**Comparator:** [Claude comparison: fallback models](CLAUDE_CODE_GAPS.md#headless--sdk-protocol). The supplied document identifies explicit fallback selection. Its local fallback source pointer has drifted; present code does not establish a runtime failure chain.

**Implementation:** Accept an explicit fallback sequence, classify retryable provider failures, preserve context and tool-call consistency, and show which model completed the run. Keep cross-provider routing opt-in.

**Acceptance:** Simulate overload/rate-limit/transient failures, unsupported capabilities, cancellation, exhausted chains, and errors that must not trigger fallback; verify completed tool actions are not replayed.

### 17. Installation and runtime doctor

**Status:** Implemented on 2026-09-13. `autohand doctor` reports runtime (version, executable, Node or Bun, platform), configuration (file, provider, model), tools from the startup checks, workspace, terminal (node-pty), Autohand account status, every configured MCP server (connected with a bounded wait, `--skip-mcp` to skip), and extension diagnostics. `--json` prints the structured report; the exit code is 1 when any item fails. Every probe is injected, so the command is unit-tested without a network or a server. Owning code: [doctor command](../src/startup/doctorCommand.ts), [registration](../src/index.ts). Validation: [unit](../tests/startup/doctorCommand.test.ts) and [built-CLI Tuistory](../tests/tuistory/doctor.tuistory.test.ts) for the human report, the JSON report, and root help.

**Original evidence:** Startup dependency checks, `/tools doctor`, and extension diagnostics existed, but there was no unified top-level install/runtime health command. Owning code: [src/startup/checks.ts:401](../src/startup/checks.ts#L401), [src/index.ts:638](../src/index.ts#L638), [src/extensions/cli.ts:1](../src/extensions/cli.ts#L1).

**Comparator:** [Claude comparison: diagnostics](CLAUDE_CODE_GAPS.md#configuration--troubleshooting). The supplied document identifies a unified top-level doctor command; existing narrower Autohand diagnostics should be reused.

**Implementation:** Add `doctor` with human and JSON output covering runtime versions, executable/PATH selection, config validity, PTY loading, authentication status, and MCP connectivity. Keep repair operations explicit.

**Acceptance:** Use fixtures for broken configs, missing executables, PTY failures, and offline diagnostics; verify exit codes, secret redaction, and a terminal help/doctor flow.

### 18. Screen-reader-friendly interactive terminal mode

**Current evidence:** UI settings expose appearance and activity controls, but no screen-reader mode. Hiding tool output or using `--bare` does not establish accessible interactive navigation. Owning code: [src/types.ts:293](../src/types.ts#L293), [src/ui/ink/InkRenderer.tsx:52](../src/ui/ink/InkRenderer.tsx#L52), [src/runtime/bareMode.ts:18](../src/runtime/bareMode.ts#L18).

**Comparator:** [Claude comparison: accessibility](CLAUDE_CODE_GAPS.md#accessibility). This candidate comes from the Claude comparison. No equivalent full screen-reader mode was verified in Codex; no-alternate-screen controls alone would not prove one.

**Implementation:** Add linear output, stable labels, predictable focus announcements, reduced animation, and keyboard-accessible prompts/menus. Retain Ink 7+ and React 19+.

**Acceptance:** Use Ink rendering and PTY/Tuistory navigation tests for prompts, permissions, menus, Ctrl+C, and exit; include a real assistive-technology check before claiming accessibility support.

### 19. MCP elicitation and interactive server requests

**Current evidence:** The MCP client models outgoing requests and incoming responses; it does not advertise or handle server-initiated elicitation forms/URL flows. Owning code: [src/mcp/McpClientManager.ts:318](../src/mcp/McpClientManager.ts#L318), [src/mcp/McpClientManager.ts:1141](../src/mcp/McpClientManager.ts#L1141), [src/mcp/types.ts:65](../src/mcp/types.ts#L65).

**Comparator:** [Codex MCP elicitation router](https://github.com/openai/codex/blob/ddf04ad26789d040f9ef6a96736f76602e35a6cc/codex-rs/codex-mcp/src/elicitation.rs#L95). Source routes server-initiated user interaction. Official app-server docs specify form/URL requests; extended openai/form support has separate capability negotiation.

**Implementation:** Negotiate elicitation support, route validated server requests into terminal/RPC interaction, return accept/decline/cancel responses, and handle expiry and shutdown.

**Acceptance:** Use a mock MCP server for forms, URL requests, unsupported schemas, user denial, timeouts, concurrent requests, and terminal navigation.

### 20. Native image generation and editing

**Current evidence:** Autohand accepts image attachments and browser screenshots but does not register a native model-callable image-generation/editing tool. Owning code: [src/core/agent/AgentDependencyComposer.ts:456](../src/core/agent/AgentDependencyComposer.ts#L456), [src/core/toolManager.ts:1680](../src/core/toolManager.ts#L1680), [src/types.ts:1607](../src/types.ts#L1607).

**Comparator:** [Codex image-generation tool](https://github.com/openai/codex/blob/ddf04ad26789d040f9ef6a96736f76602e35a6cc/codex-rs/ext/image-generation/src/tool.rs#L90). The repository implements generation and reference-image editing. Its [feature registry](https://github.com/openai/codex/blob/ddf04ad26789d040f9ef6a96736f76602e35a6cc/codex-rs/features/src/lib.rs#L1449) marks image_generation Stable/default-enabled, while the [extension](https://github.com/openai/codex/blob/ddf04ad26789d040f9ef6a96736f76602e35a6cc/codex-rs/ext/image-generation/src/extension.rs#L39) gates availability on OpenAI-compatible authentication/provider capabilities. This is source evidence, not proof for every installed CLI/provider combination.

**Implementation:** Add a capability-aware image tool that accepts prompts/reference images and returns saved artifacts. Define provider support, cost accounting, output paths, and permission behavior.

**Acceptance:** Verify provider requests and artifact metadata with mocks, then run an opt-in real-provider generation/edit check; cover unsupported models, cancellation, size limits, and output-path permissions.

## What changed since the first review

Autohand HEAD `4336efd9` versus the worktree audited on 2026-09-05, and Codex main `ee6814bfa488` versus the pin `ddf04ad26789`. Items not listed had no relevant change on either side.

| # | Autohand since 2026-09-05 | Codex since the pin |
| --- | --- | --- |
| 2 | Unchanged (implemented). | Resume picker rebuilt on the new TUI stack; read-only resume when another app holds the session; worktree-aware discovery ([#43253](https://github.com/openai/codex/pull/43253)). |
| 3 | `--allowed-tools` / `--disallowed-tools` implemented (2026-09-13). | Per-thread disabled plugin IDs, persisted and exposed via app-server ([#44332](https://github.com/openai/codex/pull/44332)). |
| 4 | `--ephemeral` implemented (2026-09-14). | "Ephemeral forks" keep the parent's cache affinity ([#44862](https://github.com/openai/codex/pull/44862)). |
| 5 | `--profile` and `--set` implemented (2026-09-14). | Permission profiles discovered from the app server, remote named selection, and profile precedence over managed defaults ([#44693](https://github.com/openai/codex/pull/44693)). |
| 6 | Unchanged. | Coordinated token refresh, manual callback input, OIDC recovery on 503, OAuth failures shown in MCP status ([#44629](https://github.com/openai/codex/pull/44629)). |
| 7 | Unchanged. | Windows sandbox adapter shipped in release artifacts, macOS terminal input-injection block, WSL interop escape block ([#44286](https://github.com/openai/codex/pull/44286)). |
| 8 | Unchanged. | Network approvals tied to the originating execution, proxy credential providers, managed network policy on Windows ([#44872](https://github.com/openai/codex/pull/44872)). |
| 9 | Unchanged. | Managed filesystem policy surfaced in doctor, managed provider requirements enforced on live threads ([#44944](https://github.com/openai/codex/pull/44944)). |
| 10 | `shell.env` inheritance policy for shell tools, hooks, and stdio MCP servers (2026-09-13). | Credential-broker environment filtering ([#44068](https://github.com/openai/codex/pull/44068)). |
| 11 | Unchanged. | Unified exec TTY support gated behind a feature flag ([#42718](https://github.com/openai/codex/pull/42718)). |
| 12 | Unchanged. | No TypeScript SDK change found; the Python SDK 0.154.0 added external messages, `include_turns`, and typed notifications ([python-v0.154.0](https://github.com/openai/codex/releases/tag/python-v0.154.0)). |
| 13 | Naming, rename, auto-naming, listing, terminal title, and resume by name implemented. | Unique session-label resolution and better automatic naming ([#43315](https://github.com/openai/codex/pull/43315)). |
| 15 | Unchanged. | Internal budgets only (review context, tool-output truncation across resume/fork); still no user-facing spend budget ([#44248](https://github.com/openai/codex/pull/44248)). |
| 17 | `autohand doctor` with `--json` and `--skip-mcp` (2026-09-13). | Four new checks: managed filesystem policy, updater settings, dumb-terminal warning, missing environment variables ([#44654](https://github.com/openai/codex/pull/44654)). |
| 19 | Unchanged. | Elicitations routed through the shared approval path, cancellation fix, capability-gated user-verification transport ([#43447](https://github.com/openai/codex/pull/43447)). |
| 20 | Unchanged. | No new user-facing image tool; attachment APIs and per-image analytics only ([#44564](https://github.com/openai/codex/pull/44564)). |

Codex capabilities that appeared since the pin and are not among the twenty:

- **Inline asynchronous questions** ([rust-v0.154.0](https://github.com/openai/codex/releases/tag/rust-v0.154.0)): the model asks a question with suggested choices while it keeps working. Autohand's question tool blocks the turn until answered. The reverse direction, the user steering a running turn, landed in Autohand on 2026-09-13 with Shift+Enter ([steering queue](../src/core/agent/SteeringQueue.ts#L16)).
- **Managed worktrees on by default** (`--worktree`, `/worktree`, [#44870](https://github.com/openai/codex/pull/44870)). Autohand has worktree isolation; it is opt-in and not tied to session fork or resume.
- **Agent command center** ([#44957](https://github.com/openai/codex/pull/44957), [#44970](https://github.com/openai/codex/pull/44970)): resume, archive, delete, and usage estimates per agent. Autohand's run inspector and `:alias` messaging ([message targets](../src/ui/messageTargets.ts#L106)) cover inspection and direct messages, not archive or per-agent usage.
- **Windows shared daemon** ([rust-v0.154.0](https://github.com/openai/codex/releases/tag/rust-v0.154.0)): sessions share one background app-server. Not applicable to Autohand's current process model.

These are candidates for a future list, not additions to this one.

## Corrections to the older gap list

- **Single-result JSON is present.** `--json local` emits one result/error object; `--output-format json` remains an unsupported alias. Do not treat the alias as a new capability. See [command output](../src/modes/commandOutput.ts#L30) and [tests](../tests/commandOutput.spec.ts#L14).
- **Bidirectional RPC is present.** Prompt acknowledgments, streamed updates, permissions, abort, and configuration methods already exist. The SDK proposal packages that existing capability; a Claude-compatible stdin format would be a separate compatibility decision. See [RPC types](../src/modes/rpc/types.ts#L209) and [prompt handling](../src/modes/rpc/adapter.ts#L557).
- **Prompt suggestions are present.** They have a config setting and runtime initialization. See [UI settings](../src/types.ts#L328) and [dependency composition](../src/core/agent/AgentDependencyComposer.ts#L392).
- **Minimal startup controls are present.** `--bare` disables many customizations and slash commands and can load only explicit MCP configuration. A standalone strict-MCP flag or corrupt-config recovery could still improve ergonomics, but the underlying capability is not wholly absent. See [bare mode](../src/runtime/bareMode.ts#L18).
- **Account settings profiles and managed connectors are present.** The remaining proposals are local run selection and non-overridable security requirements. See [control-plane integration](../src/sync/CodingAgentControlPlane.ts#L312).
- **Delegation, tasks, schedules, browser tools, worktrees, skills, and session branching are present in source.** They were excluded from the twenty as broad missing features. Hooks also have active work in this worktree; this report does not label hooks missing.
- **Undo is present.** `/undo` reverts the last recorded agent mutation and removes a conversation turn. A multi-checkpoint rewind workflow would be an extension, not a first undo capability. See [undo](../src/commands/undo.ts#L19).
- **Image input is present.** Item 20 concerns generation/editing, not attachments or screenshots. Upstream source confirmed the image tool even though the current marketing capability page describes the desktop app.
- **The old internal-fallback pointer is misleading today.** The current `fallbackModel` path handles removing a custom provider. It is not evidence of ordered runtime failover. See [provider configuration](../src/core/agent/ProviderConfigManager.ts#L2487).
- **Session naming is present (added in the second revision).** Item 13's original evidence about a hidden `--name` option is outdated; see the item for what landed and what remains.
- **Model-authored lifecycle hooks are present (added in the second revision).** `set_lifecycle_hook` installs a command hook at project, local, or user level after user review, alongside the existing script-generating `create_hook`. See [hook tools](../src/core/hookTools.ts#L16). Codex hooks are still shell commands configured by hand.
- **Skills reach delegated agents (added in the second revision).** Sub-agents and teammates receive the skills registry, can list and activate skills with the `skill` tool under their own activation state, and built-in agents declare starting skills in frontmatter (`skills:`), for example the debugger with systematic-debugging and root-cause-analysis. See [sub-agent skills](../src/core/agents/subAgentSkills.ts).
- **Codex keyboard shortcuts are available as a profile (added in the second revision).** The composer follows a selectable keybinding profile, including a Codex layout imported from its keymap file. See [profiles](../src/keybindings/profiles.ts#L128). This closes an ergonomics difference the first review did not list.

## Validation and limits

### Second revision (2026-09-13)

- Each of the twenty items was re-checked by searching Autohand HEAD `4336efd9` for the owning code and the CLI surface named in the item (output-schema options, tool allow/deny flags, ephemeral or profile flags, MCP OAuth and elicitation handling, sandbox and network backends, environment inheritance policy, a model-callable terminal handle, an SDK package, budgets outside auto-mode, ordered fallback, a doctor command, screen-reader settings, and an image-generation tool). None was found beyond what the first review recorded, except the item 13 work described above.
- Item 13's validation is the targeted unit and built-CLI Tuistory runs listed in that section. No aggregate proof run backs this revision.
- Codex drift was taken from the GitHub releases API, the release notes for `rust-v0.154.0` and `python-v0.154.0`, and the merged pull requests on main up to `ee6814bfa488`. Pull requests were not built or run; a merged change may be feature-flagged or absent from released clients.
- The Claude comparison was not re-audited in this revision.

### First review (2026-09-05)

Existing targeted tests were run to substantiate the capability exclusions:

```sh
CI=true bun run test -- tests/commandOutput.spec.ts tests/runtime/bareMode.session.test.ts tests/session/sessionBranching.test.ts tests/permissions/toolPatterns.spec.ts tests/sync/CodingAgentControlPlane.test.ts tests/sdkControlRpc.spec.ts
bun run lint
CI=true bun run proof
```

- Focused tests: **75 passed across 6 files**.
- Lint: **passed**, with four unused-variable warnings in `src/sync/CodingAgentControlPlane.ts:288`.
- Full proof: lint and typechecking passed, then the unit stage finished with **8,716 passed, 12 failed, 35 skipped; 8 failed files, 588 passed files, 2 skipped files**.
- Reported failures included MCP CLI subprocess tests, a ReactLoopRunner output timeout, the lifecycle-hook PTY test, and goal/feature-alias expectations. The run occurred while other work was modifying the repository; these results are not an isolated baseline or a diagnosis of those failures.
- The proof script stopped before its build/Tuistory stage. This report therefore makes no claim of full-product, interactive-terminal, live-provider, or release validation.
- No new production behavior was implemented, so the acceptance checks attached to each item are future implementation gates, not tests claimed to have passed in this audit.
