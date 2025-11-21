Youre an elite software engineer. The following this document as your bible.

You're expert in Typescript, CLI tools, LLM integrations, and coding agents.

you write the most beautiful, idiomatic, and efficient code possible.

You write best practices code, with safety, UX, and extensibility in mind.
You write code that is maintainable, well-structured, and easy to understand.
You write first tests, then code that passes the tests.

Typescript is your language of choice, you search for typesafety and clarity in all your code.
You follow modern Typescript conventions and idioms.
you use popular, well-maintained open source packages when appropriate.
You follow best practices for CLI tools, including clear prompts, confirmations for destructive actions, and helpful error messages.
You design coding agents that are safe, reliable, and user-friendly.

# Autohand Coding Agent CLI

## Vision

`autohand` is a TypeScript-first interactive coding agent that mirrors the ergonomics of the Codex CLI. It lives in the terminal, reads and writes files, runs structured commands, and orchestrates multi-step coding sessions driven by natural language. The tool blends local context gathering (git status, filesystem tree, recent edits) with remote LLM reasoning so it can safely plan, explain, and execute changes inside any workspace.

## Core Capabilities

- **Hybrid interaction** – Launch `autohand` without args for a REPL-like session, or pass `--prompt` to run single commands in CI or shell aliases.
- **LLM-driven workflow** – Prompts are streamed to the configured OpenRouter model; responses are parsed into concrete actions (`read_file`, `apply_patch`, `run_command`, etc.) and executed with user-approved safety checks.
- **Filesystem agency** – Rich actions exist for directory lifecycle (`create_directory`, `delete_path`, `rename_path`, `copy_path`), structured replace/formatting (`replace_in_file`, `format_file`), search-with-context, metadata lookups, and dependency editing so the agent can do more than dump patches.
- **Action planner** – Deterministic planner interprets LLM output, queues actions, pauses before risky steps, and feeds execution results back to the model until the task is done.
- **Custom commands** – When the LLM proposes new helpers, Autohand asks for approval, stores them under `~/.autohand-cli/commands/`, and reuses them later without another prompt.
- **Config-aware** – Uses `~/.autohand-cli/config.json` for API keys, default model, workspace defaults, TUI settings, and persisted slash-command changes (e.g., `/model`).

## Recommended Tech Stack

| Area | Package(s) | Notes |
| --- | --- | --- |
| CLI framework | [`commander`](https://www.npmjs.com/package/commander) | Lightweight option for command mode flags. |
| Interactive UI | [`readline`](https://nodejs.org/api/readline.html) + custom prompt, [`enquirer`](https://www.npmjs.com/package/enquirer) for modals | Enables live `@` mentions, slash palette, confirmations. |
| FS helpers | [`fs-extra`](https://www.npmjs.com/package/fs-extra) | Async-friendly FS operations + ensure/remove helpers. |
| Diff/Patching | [`diff`](https://www.npmjs.com/package/diff) | Generates unified patches compatible with `apply_patch`. |
| Search | Native `rg` invocation (`ripgrep`) | Fast repo scans + contextual snippets. |
| Streaming client | Native `fetch` against OpenRouter | Handles AbortController cancellation + custom headers. |

## Configuration Contract

`~/.autohand-cli/config.json` drives runtime behavior. Example shape:

```json
{
  "openrouter": {
    "apiKey": "sk-or-...",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "anthropic/claude-3.5-sonnet"
  },
  "workspace": {
    "defaultRoot": "/Users/alex/projects",
    "allowDangerousOps": false
  },
  "ui": {
    "theme": "dark",
    "autoConfirm": false
  }
}
```

- `/model` writes back to this file so sessions persist the chosen default model.
- Manual edits are linted; invalid keys or non-JSON changes yield clear errors before launch.

## Launch Modes

1. **Interactive (`autohand`)**
   - Shows banner + current model/workspace.
   - REPL prompt (`›`) supports live `@` mention autocomplete, slash commands, ESC cancellation, and double-Ctrl+C exit.
   - Streams LLM reasoning, pauses before destructive ops, supports undo and custom commands.

2. **Command mode (`autohand --prompt "add tests" --path src/foo.ts`)**
   - Runs a single instruction without the TUI, exits with non-zero status on failure.
   - Useful for CI hooks, aliases, or scripts.

Both modes share the same planner/executor and config loader.

## Prompt Construction

Each instruction becomes a structured prompt containing:

- Workspace summary (root path, git status, recent files, slash-command overrides).
- Mentioned file context (live `@file` autocomplete injects contents automatically).
- Tool affordances (the JSON schema listing every action, including custom commands and metadata helpers).
- Config-derived preferences (model, dry-run, approval policy).

## File Mentions

- Typing `@` inside the prompt instantly surfaces a filtered file list (powered by `git ls-files`, falling back to manual walks). Suggestions update as you type; hit `Tab` to insert the top match without pressing Enter.
- Mentioned files are resolved before the LLM call and their contents are appended to the prompt so the model has immediate context for diffs.
- Multiple mentions per instruction are supported.

## Slash Command Palette

Typing `/` opens an interactive list matching Codex’s palette:

| Command | Effect |
| --- | --- |
| `/ls` | List workspace files locally. |
| `/diff` | Show git status + diff (including untracked notice). |
| `/undo` | Revert the last Autohand mutation via stored patches. |
| `/model` | Prompt for a new OpenRouter model and persist it. |
| `/approvals` | Toggle whether actions auto-confirm. |
| `/review` | Seed an LLM review instruction for current changes. |
| `/new` | Reset the conversation context. |
| `/init` | Scaffold an `AGENTS.md` template in the workspace. |
| `/compact` | Tell the agent to summarize/trim context. |

## Custom Commands

- When the LLM emits a `custom_command`, Autohand describes it, warns if it looks dangerous (`rm`, `sudo`, etc.), and asks for explicit approval.
- Approved commands are saved under `~/.autohand-cli/commands/<name>.json` and run locally (with the same ESC cancel pipeline) next time without extra prompts.
- Rejected commands are skipped and reported back to the LLM.

## Execution Flow

1. **Session bootstrap** – Load/validate config (creating defaults if needed), parse CLI flags, resolve workspace, warm up logs.
2. **Goal intake** – Capture instruction via REPL or `--prompt`, gather live `@file` contexts.
3. **Context gathering** – Collect git status, list trees, mention contexts, and slash-command overrides.
4. **LLM call** – Stream the prompt to OpenRouter with AbortController so ESC can cancel mid-request.
5. **Action dispatch** – Validate each action (workspace path guard, confirmation for deletions/custom commands), execute via modules (`filesystem`, `command`, `dependencies`, `metadata`, `git`, etc.), and record diffs/undo info.
6. **User confirmation** – Destructive operations (e.g., `delete_path`) require explicit consent unless `--yes`/autoConfirm is enabled.
7. **Iteration** – Feed outputs/errors back to the model, continue until plan succeeds or user cancels.

## Safety & UX Considerations

- ESC cancels in-flight LLM requests; first Ctrl+C warns, second exits.
- Undo stack (`/undo` or `undoLast`) stores previous file contents for quick rollback.
- `delete_path` and custom commands require consent by default; dangerous commands are flagged.
- Dry-run mode (`--dry-run`) previews actions without applying mutations.

## Extensibility Hooks

- **Tool plugins** – Actions are just TypeScript methods; it’s easy to add new ones (e.g., `run_tests`, `deploy_preview`) without touching the planner.
- **Model adapters** – `OpenRouterClient` can be swapped for OpenAI/Azure/Anthropic wrappers by matching the interface.
- **Custom command registry** – JSON definitions in `~/.autohand-cli/commands/` allow teams to share bespoke helpers.

## Developer Experience

- Built in modern TypeScript; uses `tsup` for bundling, `tsx` for dev, and `bun` scripts.
- Type-checked via `bun run typecheck`; future work includes vitest suites for filesystem/mention logic.
- Publish as an npm package with `bin` entry `autohand` so users can install globally (`npm i -g autohand-cli`).

With this restored `AGENTS.md`, Autohand once again documents how the CLI should behave: Codex-like REPL, live mentions, slash palette, structured actions, custom-command consent, and safety-first execution.
