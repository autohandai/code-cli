# Claude Code → Autohand Gap Analysis

What Claude Code exposes that Autohand does not, across two surfaces: the **CLI surface** (flags and subcommands) and the **tool surface** (built-in tools available to the model).

Consolidates and supersedes the former `docs/cc-src-tool-gap-analysis.md` (2026-05-07), whose tool-surface findings were largely obsolete — see [Closed since the 2026-05 review](#closed-since-the-2026-05-review).

**Reviewed:** 2026-08-03 · **Autohand ref:** `main` @ `59468034`

**Method.** Verified against source, not help text or memory:

- Autohand CLI: every `.option()` / `.command()` registration in `src/`
- Autohand tools: every `name:` entry in `src/core/toolManager.ts`
- Claude Code CLI: `claude --help`
- Claude Code tools: `/Users/igorcosta/Downloads/cc-src/constants/tools.ts` and `constants/prompts.ts`

---

## Part 1 — CLI surface

### Session lifecycle

| Claude Code | Gap in Autohand |
| --- | --- |
| `-c, --continue` | No "resume most recent session in this cwd". `resume <sessionId>` requires an explicit ID (`src/index.ts:614`). |
| `-r, --resume [value]` (picker + search) | Picker exists only as the in-session `/resume`; no CLI-level picker or search term. |
| `--session-id <uuid>` | No way to pin a deterministic session ID. Nothing in source outside MCP transport IDs. |
| `--no-session-persistence` | No ephemeral / no-disk session mode. |
| `-n, --name <name>` | No session display name (prompt box, picker, terminal title). |
| `--from-pr [value]` | `/pr-review` exists, but no resuming a session linked to a PR. |
| `--fork-session` | **Partial** — `--fork <pathOrId>` already covers session branching. |

### Headless / SDK protocol

Largest cluster of gaps.

- `--output-format json` (single-result JSON). Autohand supports only `stream-json`, plus `--json stream|local` (`src/index.ts:227-228`).
- `--input-format stream-json` — bidirectional streaming stdin. Autohand's ACP/RPC modes cover editor integration but not the generic "pipe turns in" SDK pattern.
- `--include-partial-messages` — no partial chunk emission control.
- `--replay-user-messages` — no stdin echo/ack for stream-json.
- `--include-hook-events` — hook lifecycle events are not in the output stream.
- `--forward-subagent-text` — subagent text/thinking is not forwarded with a parent tool-use ID.
- `--json-schema <schema>` — no structured-output validation.
- `--max-budget-usd` — `--max-cost` exists but is auto-mode only, not print/command mode.
- `--fallback-model <list>` — internal fallback exists (`src/core/agent/ProviderConfigManager.ts:2349`) but no user-specified ordered fallback list.

### Permissions & tool scoping

- `--allowedTools` / `--disallowedTools` / `--tools` — Autohand has an internal `src/core/toolFilter.ts` and per-subagent tool lists (`src/core/agents/SubAgent.ts:108`), but no CLI surface. `--yolo allow:read,write` is the closest and is coarser.
- `--permission-mode <mode>` — Autohand's modes are `interactive | unrestricted | restricted | external` (`src/types.ts:390`). No `acceptEdits`, no `dontAsk`, and no CLI flag to *enter* plan mode. Plan mode itself exists via Shift+Tab (`src/commands/plan.ts`).
- `--agent <agent>` — `--agents <json>` defines agents, but there is no way to select one for the session.

### Configuration & troubleshooting

- `doctor` top-level command — only `/tools doctor` and `extensions doctor` exist; no install health check.
- `--safe-mode` — no "disable all customizations to debug a broken config" escape hatch.
- `--settings <file-or-json>` — Autohand's `--settings` opens the settings UI instead; no way to inject settings from a file or JSON string.
- `--setting-sources <sources>` — no control over which config layers load.
- `--verbose`, `-d [filter]` category filtering, `--debug-file <path>` — Autohand's `-d` is a boolean only (`src/index.ts:236`).

### Extensibility

- `--strict-mcp-config` — cannot restrict to `--mcp-config` servers and ignore all other MCP configuration.
- `--plugin-url <url>` — `--plugin-dir` only; no remote plugin fetch.
- `--disable-slash-commands`.
- `--exclude-dynamic-system-prompt-sections` — no prompt-cache reuse optimization across users/machines.

### Runtime integrations

- `--bg, --background` + `claude agents` management — Autohand's `agents` / `squad` show running agents, but there is no "detach this session as a background agent" launch path.
- `--ide` auto-connect on startup — `/ide` slash command exists (`src/commands/ide.ts`), no startup flag.
- `--remote-control [name]` and `--remote-control-session-name-prefix`.
- `--file <file_id:path>` startup resource download.
- `--brief` (agent→user messaging tool).
- `--prompt-suggestions`.
- `--betas <betas...>`.
- `--effort <level>` — `--thinking` is the nearest analogue, but it is reasoning depth, not an effort budget.

### Accessibility

- `--ax-screen-reader` — flat text output, no decorative borders or animations.

Nothing in the codebase matches `screenReader|a11y|accessib` outside browser-tool locators. For a TUI-heavy product this ranks as a genuine inclusion gap rather than a missing convenience.

### Subcommands

| Claude Code | Notes |
| --- | --- |
| `auth` | Autohand has `login` / `logout` but no unified auth manager. |
| `setup-token` | No long-lived authentication token setup. |
| `install [target]` | No native-build installer (Autohand has `update` / `upgrade` only). |
| `gateway` | No enterprise auth/telemetry gateway. |
| `project` | No project-state management command. |
| `plugin \| plugins` | Autohand's nearest equivalent is `extensions`. |
| `ultrareview` | No cloud-hosted multi-agent branch review. |
| `auto-mode` | Different semantics — Claude's inspects/resets a classifier; Autohand's `--auto-mode` is an autonomous loop. Name collision, not a gap. |

### Not gaps — already covered

`--add-dir`, `--worktree`, `--tmux`, `--bare`, `--mcp-config`, `--plugin-dir`, `--agents`, system-prompt replace/append (plus `-file` variants Claude does not advertise), hooks (`/hooks`), plan mode (Shift+Tab), and browser integration (`--browser`, `browser` subcommand) against Claude's `--chrome`.

### Flag collisions

Three flags mean different things in each CLI. These will bite anyone aliasing between the two:

| Flag | Claude Code | Autohand |
| --- | --- | --- |
| `-c` | `--continue` (resume last session) | `--auto-commit` |
| `--settings` | Load settings from file or JSON string | Open the settings UI |
| `--project` | Manage project state (subcommand) | Install skill at project level (`--skill-install` modifier) |

---

## Part 2 — Tool surface

Autohand's built-in tool surface is now at or ahead of `cc-src` on nearly every axis. Only two true gaps remain.

### Open gaps

| `cc-src` tool | Autohand | Gap | Priority |
| --- | --- | --- | --- |
| `WORKFLOW_TOOL_NAME` | none | No reusable workflow execution tool. Gated behind a `WORKFLOW_SCRIPTS` feature flag in `cc-src`, so it is not fully shipped there either. | Low |
| `SYNTHETIC_OUTPUT_TOOL_NAME` | none | No synthetic output/channel tool. | Low |

### Covered under a different name

Worth knowing, since name-matching against `cc-src` gives false positives:

| `cc-src` | Autohand equivalent |
| --- | --- |
| `AGENT_TOOL_NAME` | `delegate_task`, `delegate_parallel` (+ `find_sub_agents`, `install_sub_agent`) |
| `TASK_CREATE_TOOL_NAME` | `create_task` |
| `CRON_LIST_TOOL_NAME` | `list_schedules`, `cancel_schedule` |
| `SEND_MESSAGE_TOOL_NAME` | `send_team_message` |
| `FILE_EDIT_TOOL_NAME` | `apply_patch`, `search_replace` |
| `GREP_TOOL_NAME` | `fff_grep`, `fff_find` (broader) |
| `BASH_TOOL_NAME` / shell | `run_command`, `shell` |
| `ASK_USER_QUESTION_TOOL_NAME` | `ask_followup_question` |

Direct name matches already present: `task_get`, `task_list`, `task_update`, `task_stop`, `task_output`, `tool_search`, `notebook_edit`, `enter_worktree`, `exit_worktree`, `cron_create`, `cron_delete`, `skill`, `sleep`, `todo_write`, `tools_registry`, `exit_plan_mode`, `plan`, `read_file`, `write_file`, `glob`-equivalents, `web_search`, `fetch_url`.

### Closed since the 2026-05 review

The superseded doc listed these as gaps. All have shipped, which is why it was retired rather than merged verbatim:

- **High priority, now closed:** first-class agent delegation, `create_task` / `task_get` / `task_list` / `task_update` / `task_stop` / `task_output`
- **Medium priority, now closed:** `tool_search`, `notebook_edit`, `enter_worktree`, `exit_worktree`, `cron_create`, `cron_delete`, `skill`, team messaging

Autohand additionally has a large surface with no `cc-src` counterpart: the full `browser_*` family, `git_worktree_*` orchestration, goal/queue tools, experiment tools, memory tools (`save_memory`, `recall_memory`, `inspect_memory`), `create_meta_tool`, and `code_review`.

---

## Part 3 — Prompt guidance

Differences in how each system instructs the model. Three of the four recommendations from the 2026-05 review have since been adopted.

| Guidance | Status in Autohand |
| --- | --- |
| Prefer dedicated tools over shell | **Adopted** — `SystemPromptBuilder.ts:206` |
| Maximize parallel tool calls | **Adopted** — `SystemPromptBuilder.ts:495,525-528` (capped at 5 per response) |
| Tell users to run interactive commands with `! <command>` | **Adopted** — `SystemPromptBuilder.ts:284` |
| Distinguish direct search from delegated exploration | **Open** — no `delegate_task` guidance in `SystemPromptBuilder.ts`. The tools exist but the prompt never teaches when to reach for them, so delegation is likely under-used. |

Remaining from `cc-src` worth considering: their prompt treats task tools as an always-on progress mechanism rather than an optional helper.

---

## Suggested priority

Ranked by leverage, highest first. CLI-surface gaps now dominate — the tool surface is essentially at parity.

1. **Headless JSON / stream protocol** — `--output-format json`, `--input-format stream-json`, partial messages. Blocks SDK and CI consumers.
2. **`--continue` and a CLI resume picker** — highest-frequency daily ergonomics gap.
3. **`--allowedTools` / `--disallowedTools` CLI surface** — the filtering engine already exists; plumbing, not new capability.
4. **Delegation prompt guidance** — cheapest item on this list. Tools are built; the prompt just doesn't mention them.
5. **`doctor`** — cuts support burden for broken installs.
6. **`--ax-screen-reader`** — accessibility; small surface, real users.
