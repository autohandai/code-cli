Youre an elite software engineer. The following this document as your bible.

NEVER FIX A bug before investigating existing test coverage, existing function implementation,
analyze the entire bug, updating the existing test, add more deep well crafted test, pass the test and then write the code from it, lint
and ALWAYS run bun run proof and the claim victory that you fixed the problem.

NEVER write this to my commit messages Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

You're expert in Typescript, CLI tools, LLM integrations, and coding agents.

## Current `cli-3` Architecture Snapshot

The active agent runtime in this repo is organized under `src/core/agent` with strict layer boundaries. Use this map when touching core behavior:

- `src/core/agent.ts` (`AutohandAgent`) is the public orchestration façade.
- `src/core/agent/AgentLifecycleRunner.ts` is responsible for run lifecycle (interactive/command mode entry, background init, teardown, signal handling).
- `src/core/agent/InputTurnCoordinator.ts` owns request intake, queue behavior, and cancel/interrupt input paths.
- `src/core/agent/AgentDependencyComposer.ts` centralizes dependency creation on the runtime host.
- `src/core/agent/AgentContextRuntime.ts` and `SessionBootstrapBuilder.ts` handle bootstrap context and AGENTS/session injection.
- `src/core/agent/SystemPromptBuilder.ts`, `PromptInstructionReader.ts`, and `ReactionParser.ts` handle prompt composition and response parsing.
- `src/core/agent/ReactLoopRunner.ts`, `ToolLoopSignature.ts`, and `InstructionRunner.ts` implement the execution turn loop and tool-call lifecycle.
- `src/core/agent/AgentUIRuntime.ts`, `AgentCommandRuntime.ts`, `AgentProjectOperations.ts`, and `ProviderConfigManager.ts` hold UI/runtime command, project-op, and provider domains.
- Cross-cutting services (`WorkspaceFileCollector`, `MentionResolver`, `ShellSuggestionProvider`, `McpStartupCoordinator`) live in `src/core/agent` to keep orchestration and protocol boundaries co-located.

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
- **Custom commands** – When the LLM proposes new helpers, Autohand asks for approval, stores them under `~/.autohand/commands/`, and reuses them later without another prompt.
- **Config-aware** – Uses `~/.autohand/config.json` for API keys, default model, workspace defaults, TUI settings, and persisted slash-command changes (e.g., `/model`).

## Recommended Tech Stack

| Area             | Package(s)                                             | Notes                                                                                         |
| ---------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| CLI framework    | [`commander`](https://www.npmjs.com/package/commander) | Lightweight option for command mode flags.                                                    |
| Interactive UI   | [`ink`](https://www.npmjs.com/package/ink)             | React-based TUI for live `@` mentions, slash palette, streaming responses, and confirmations. |
| FS helpers       | [`fs-extra`](https://www.npmjs.com/package/fs-extra)   | Async-friendly FS operations + ensure/remove helpers.                                         |
| Diff/Patching    | [`diff`](https://www.npmjs.com/package/diff)           | Generates unified patches compatible with `apply_patch`.                                      |
| Search           | Native `rg` invocation (`ripgrep`)                     | Fast repo scans + contextual snippets.                                                        |
| Streaming client | Native `fetch` against OpenRouter                      | Handles AbortController cancellation + custom headers.                                        |

## Configuration Contract

`~/.autohand/config.json` drives runtime behavior. Example shape:

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

| Command     | Effect                                                |
| ----------- | ----------------------------------------------------- |
| `/undo`     | Revert the last Autohand mutation via stored patches. |
| `/model`    | Prompt for a new OpenRouter model and persist it.     |
| `/new`      | Reset the conversation context.                       |
| `/init`     | Scaffold an `AGENTS.md` template in the workspace.    |
| `/help`     | Show available commands.                              |
| `/quit`     | Exit Autohand.                                        |
| `/sessions` | List saved sessions.                                  |
| `/resume`   | Resume a previous session.                            |
| `/memory`   | Manage project and user memory.                       |
| `/feedback` | Submit feedback about the CLI.                        |
| `/agents`   | Manage sub-agents.                                    |

## Custom Commands

- When the LLM emits a `custom_command`, Autohand describes it, warns if it looks dangerous (`rm`, `sudo`, etc.), and asks for explicit approval.
- Approved commands are saved under `~/.autohand/commands/<name>.json` and run locally (with the same ESC cancel pipeline) next time without extra prompts.
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
- **Custom command registry** – JSON definitions in `~/.autohand/commands/` allow teams to share bespoke helpers.

## Developer Experience

- Built in modern TypeScript; uses `tsup` for bundling, `tsx` for dev, and `bun` scripts.
- Type-checked via `bun run typecheck`; future work includes vitest suites for filesystem/mention logic.
- Publish as an npm package with `bin` entry `autohand` so users can install globally (`npm i -g autohand-cli`).

With this restored `AGENTS.md`, Autohand once again documents how the CLI should behave: Codex-like REPL, live mentions, slash palette, structured actions, custom-command consent, and safety-first execution.

## Critical Development Rules

- NEVER skip using the clean-coder skill when appropriate
- NEVER commit to git without explicit user consent
- ALWAYS use Ink for TUI components: https://www.npmjs.com/package/ink
  - Reference documentation: https://github.com/vadimdemedes/ink/tree/master/examples
- When you find a root cause you MUST Write a TDD and you never Ever regression that issue again and you learn from your mistakes so you don't repeat.
- ALWAYS import `fs-extra` as default import (`import fse from 'fs-extra'`) — NEVER use named imports (`import { pathExists } from 'fs-extra'`). Named imports break at runtime in ESM bundles because fs-extra is a CJS module.
- When importing/parsing data from external agents (Claude Code, Codex, etc.), ALWAYS test with real data formats. System-injected messages (XML tags like `<user_instructions>`, `<environment_context>`, `<system-reminder>`) must be filtered or stripped — never use them as user-facing summaries.
- NEVER patch code without writing a regression test first. Every bug fix must include a test that fails before the fix and passes after. No exceptions.
- When writing tests for data parsers/importers, ALWAYS include edge cases: empty input, malformed data, system-injected content mixed with real content, and boundary conditions (truncation, missing fields).

1. Plan Node Default
   •Enter plan mode for any non-trivial task (three or more steps, or involving architectural decisions).
   •If something goes wrong, stop and re-plan immediately rather than continuing blindly.
   •Use plan mode for verification steps, not just implementation.
   •Write detailed specifications upfront to reduce ambiguity.

2. Subagent Strategy
   •Use subagents liberally to keep the main context window clean.
   •Offload research, exploration, and parallel analysis to subagents.
   •For complex problems, allocate more compute via subagents.
   •Assign one task per subagent to ensure focused execution.

3. Self-Improvement Loop
   •After any correction from the user, update tasks/lessons.md with the relevant pattern.
   •Create rules for yourself that prevent repeating the same mistake.
   •Iterate on these lessons rigorously until the mistake rate declines.
   •Review lessons at the start of each session when relevant to the project.

4. Verification Before Done
   •Never mark a task complete without proving it works.
   •Diff behavior between main and your changes when relevant.
   •Ask: “Would a staff engineer approve this?”
   •Run tests, check logs, and demonstrate correctness.

5. Demand Elegance (Balanced)
   •For non-trivial changes, pause and ask whether there is a more elegant solution.
   •If a fix feels hacky, implement the solution you would choose knowing everything you now know.
   •Do not over-engineer simple or obvious fixes.
   •Critically evaluate your own work before presenting it.

6. Autonomous Bug Fixing
   •When given a bug report, fix it without asking for unnecessary guidance.
   •Review logs, errors, and failing tests, then resolve them.
   •Avoid requiring context switching from the user.
   •Fix failing CI tests proactively.

Task Management
1.Plan First: Write the plan to tasks/todo.md with checkable items.
2.Verify Plan: Review before starting implementation.
3.Track Progress: Mark items complete as you go.
4.Explain Changes: Provide a high-level summary at each step.
5.Document Results: Add a review section to tasks/todo.md.
6.Capture Lessons: Update tasks/lessons.md after corrections.

Core Principles
•Simplicity First: Make every change as simple as possible. Minimize code impact.
•No Laziness: Identify root causes. Avoid temporary fixes. Apply senior developer standards.
•Minimal Impact: Touch only what is necessary. Avoid introducing new bugs.
