# What's New in Autohand Code CLI 0.9.0

Autohand Code CLI 0.9.0 is the largest release train since 0.8.0. It turns the CLI from a capable terminal coding agent into a broader coding workstation: Ink is now the primary TUI, provider support is much wider, Chrome automation is built in, skills can be discovered and generated from the CLI, recurring work can be scheduled, code review has its own flow, and the agent runtime has been broken into clearer, safer modules.

This document summarizes the work from `v0.8.0` through the current 0.9.0 branch state on May 5, 2026. It includes the 0.8.1, 0.8.2, 0.8.3, and current 0.9.0 development changes that were made after the previous `docs/whats-new-0.8.0.md` release note.

## Table of Contents

- [Release Themes](#release-themes)
- [Upgrade Highlights](#upgrade-highlights)
- [Ink 7 TUI Is Now the Default](#ink-7-tui-is-now-the-default)
- [Composer, Mentions, and Keyboard Editing](#composer-mentions-and-keyboard-editing)
- [Provider Expansion](#provider-expansion)
- [ChatGPT Login and Mandatory Account Flow](#chatgpt-login-and-mandatory-account-flow)
- [Chrome Integration and Browser Automation](#chrome-integration-and-browser-automation)
- [Skills, Learn, and Skill Mentions](#skills-learn-and-skill-mentions)
- [Code Review Workflows](#code-review-workflows)
- [Recurring Work and Scheduling](#recurring-work-and-scheduling)
- [Automation, Parallel Tools, and Orchestration](#automation-parallel-tools-and-orchestration)
- [Shell, Search, File, and Workspace Tools](#shell-search-file-and-workspace-tools)
- [Plan Mode, Auto Mode, and Non-Interactive Behavior](#plan-mode-auto-mode-and-non-interactive-behavior)
- [Permissions and Workspace Safety](#permissions-and-workspace-safety)
- [Context, Memory, and Session Accounting](#context-memory-and-session-accounting)
- [Hooks, ACP, RPC, and SDK-Facing Surfaces](#hooks-acp-rpc-and-sdk-facing-surfaces)
- [Onboarding, Setup, and Configuration](#onboarding-setup-and-configuration)
- [Install, Release, and Bundled Runtime Improvements](#install-release-and-bundled-runtime-improvements)
- [Documentation and Examples](#documentation-and-examples)
- [Reliability, Testing, and CI](#reliability-testing-and-ci)
- [Current 0.9.0 Branch Work](#current-090-branch-work)
- [Migration Notes](#migration-notes)
- [Known Compatibility Notes](#known-compatibility-notes)
- [Full Change Inventory](#full-change-inventory)

---

## Release Themes

0.9.0 is about making Autohand Code CLI feel dependable during real work:

- **The terminal UI is no longer experimental.** Ink 7 and React 19 are the baseline, the Ink TUI is the default path, and a large amount of work went into modal lifecycle, raw-mode handling, composer stability, and predictable slash command behavior.
- **Providers are first-class product surfaces.** OpenAI, OpenRouter, LLMGateway, Azure, Vertex AI, Z.ai, xAI, Cerebras, NVIDIA, DeepSeek, and local providers are wired through setup, `/model`, config loading, docs, and tests.
- **Autohand can work beyond the terminal.** Chrome integration adds browser tools, native-host wiring, `/chrome`, browser skill injection, and documentation for extension handoff.
- **Skills are now discoverable and composable.** `/learn`, `/skills`, `$skill` mentions, skill discovery tools, installation/update metadata, telemetry, and a security scanner make skill workflows much more practical.
- **Automation became real.** Repeat jobs, schedules, cron create/delete tools, background shell commands, project/task tools, worktree tools, notebook cell editing, and parallel execution all push Autohand toward longer-running agent workflows.
- **The core has been refactored for maintainability.** Agent orchestration, interactive lifecycle, UI runtime, command runtime, session accounting, context runtime, tool output runtime, project operations, and instruction execution now live behind clearer boundaries.

---

## Upgrade Highlights

### Most Visible User Changes

- Ink 7 TUI is now the default interactive experience.
- The composer supports richer multiline editing, paste handling, command/file/skill mentions, queue editing, ghost text, and stable resize behavior.
- `/setup` and `--setup` can run setup from interactive, ACP, and JSON-RPC flows.
- `/review` and `/pr-review` add explicit code review workflows.
- `/repeat` and `--repeat` support recurring prompt scheduling.
- `/automode on` and `/automode off` expose interactive auto-mode control.
- `/chrome` and `--chrome` connect the CLI to Chrome extension/browser automation workflows.
- `$skill` mentions allow direct skill injection into the prompt.
- `!` shell command handling is richer, including autocomplete and background execution.
- Mandatory login and registration flows make account state explicit before use.

### Most Important Engineering Changes

- Provider setup and model switching were expanded and tested across more cloud providers.
- Context compaction was extracted into `src/core/context/`.
- Mutating tools can be serialized for safety while independent tools can run in parallel.
- File mutation hooks now include more accurate change metadata.
- Image payloads and pasted blocks are bounded to avoid context and UI blowups.
- Permission behavior is stricter and more consistent across interactive and non-interactive modes.
- The proof/test suite was hardened for deterministic local and CI runs.

---

## Ink 7 TUI Is Now the Default

Autohand now defaults to the Ink TUI. This was not a cosmetic switch; the branch includes a full reliability pass around rendering, input ownership, modals, slash commands, and cleanup.

### What Changed

- Upgraded the app path to Ink 7 and React 19 expectations.
- Routed Ink startup through `UIManager`.
- Added `InkUIManager` public contract tests.
- Made the Ink TUI the default entry point.
- Restored local handling for slash commands in the Ink queue path.
- Fixed composer blocking after LLM turns and after slash command completion.
- Made `/clear`, `/new`, `/help`, `/about`, and memory storage visible and functional in TUI mode.
- Closed slash dropdowns with a single `ESC`.
- Routed double `Ctrl+C` through the quit flow.
- Added safer cleanup so exit output is printed after the active composer is torn down.
- Removed obsolete Ink compatibility patches after the upgrade.

### Why It Matters

The TUI now behaves like the product surface rather than a compatibility layer. Users can stay in the terminal for provider setup, prompt entry, slash commands, shell commands, plan mode, model changes, queue review, and long-running tool output without fighting stale input regions or stuck modals.

---

## Composer, Mentions, and Keyboard Editing

The composer received a deep rewrite across 0.8.x and 0.9.0.

### Multiline Editing

Autohand added a `TextBuffer` model for terminal input:

- Insert, backspace, delete, home, end, left, right, up, and down.
- Visual layout with word wrapping.
- Bidirectional mapping between logical cursor position and rendered rows.
- Preferred-column behavior for vertical cursor movement.
- Word navigation with `Intl.Segmenter`.
- Dynamic composer height.
- Literal multiline input.
- Shift+Enter support without leaking `13~` fragments.
- Tests for edge cases and regressions.

### File Mentions

File mentions became faster and more reliable:

- `@` mention detection updates synchronously as the input buffer changes.
- Tab acceptance uses buffer-accurate cursor offsets.
- Suggestion refresh happens immediately for Tab and arrow keys.
- Mention preview can handle fresh suggestions without waiting for React state flush.
- The current branch includes session diff line stats and line extension examples that make status lines richer and extensible.

### Skill Mentions

0.9.0 introduces `$skill` autocomplete:

- `$` opens skill mention discovery.
- Skill mention previews show useful context before insertion.
- Skills can be injected into the active prompt without manual copy/paste.
- The skill mention menu was restored after later Ink refactors.

### Shell Commands in Composer

The `!` command path is now more capable:

- LLM-backed shell command autocomplete.
- Tab accept for shell suggestions.
- Background shell command support.
- Safer output routing through live command rendering.
- Better distinction between shell operators and direct command execution.

---

## Provider Expansion

Provider support is one of the biggest release areas.

### Newly Added or Expanded Providers

| Provider | What Changed |
| --- | --- |
| **Azure Foundry / Azure OpenAI** | Added token management, API key auth, Entra ID, Managed Identity, Azure client, provider implementation, env/config wiring, interactive setup, `/model` support, onboarding options, and tests. |
| **Vertex AI** | Added richer settings change flow, auth refresh support, model/context updates, Anthropic-native support, i18n coverage, and persistence fixes. |
| **Z.ai** | Added Z.ai provider support, docs, provider errors, and i18n. |
| **xAI** | Added provider display/i18n coverage and model-related setup polish. |
| **Cerebras AI** | Added provider support with `x-source` headers and persistence tests. |
| **NVIDIA AI Cloud** | Added NVIDIA provider support, default models, setup integration, and provider docs. |
| **DeepSeek** | Current 0.9.0 branch adds a dedicated DeepSeek provider, setup wizard path, `/model` configuration, docs, tests, config parsing, and ACP model list updates. |
| **OpenAI** | Added ChatGPT account auth, cleaner API-key setup, provider-specific errors, and model docs refreshes. |
| **OpenRouter** | Updated defaults, attribution headers, async vision detection, and model fallback behavior. |
| **Ollama / llama.cpp / MLX** | Improved local-provider errors, setup guidance, timeouts, malformed request handling, and local inference behavior. |

### DeepSeek Support

The current 0.9.0 branch adds DeepSeek as a first-class provider:

```json
{
  "provider": "deepseek",
  "deepseek": {
    "apiKey": "your-deepseek-api-key",
    "baseUrl": "https://api.deepseek.com",
    "model": "deepseek-v4-flash"
  }
}
```

DeepSeek is now wired through:

- `ProviderFactory`
- `ProviderName`
- `AutohandConfig`
- `loadConfig` and `getProviderConfig`
- setup wizard provider selection
- model selection
- `/model` provider configuration
- i18n display names
- config reference docs
- providers docs
- provider tests
- onboarding persistence tests

### Model Defaults and Capability Updates

The branch also updates model references across docs and tests:

- OpenRouter defaults move toward `openrouter/auto`.
- Anthropic examples move away from older timestamped Sonnet identifiers.
- OpenAI examples now use GPT-5-family naming in docs and tests.
- Gemini examples include Gemini 3.0 references.
- Context-window and vision-capability tests were refreshed for newer model IDs.

---

## ChatGPT Login and Mandatory Account Flow

0.9.0 adds a more opinionated authentication story.

### ChatGPT Account Auth

Users coming from OpenAI can now authenticate using a ChatGPT account in addition to a direct API key:

- Browser-based ChatGPT auth flow.
- OpenAI auth core types.
- Streaming/debug-line rendering fixes.
- Startup validation that preserves credentials when a network failure occurs.
- Local token trust when the server returns a 401 for an unexpired session.
- Setup improvements that let users choose between API key and ChatGPT account auth.

### Mandatory CLI Login

The CLI now requires authentication before use:

- Login gate before normal CLI operation.
- Registration flow with retry support.
- Welcome screen with logo and Login/Exit prompt.
- `/logout` uses modal UI.
- Non-interactive login paths avoid sync restore issues.
- Missing browser opener fallbacks are handled more gracefully on Linux.

---

## Chrome Integration and Browser Automation

Chrome support grew from an integration idea into a tool surface.

### User-Facing Entry Points

- `/chrome` command.
- `--chrome` and `--no-chrome` flags.
- Chrome extension integration docs.
- Browser handoff stability improvements.
- `AUTOHAND_CODE` environment variable for integration detection.

### Browser Tools

Autohand added browser automation tools for:

- tabs
- tab groups
- network inspection
- console inspection
- Chrome extension bridge calls
- browser JavaScript execution

The browser skill can be injected in RPC mode and browser bridge responses are routed safely back to clients.

### Native Host and Runtime Hardening

The release includes fixes for:

- native host argument filtering
- shebang resolution
- Linux browser fallback behavior
- Bun path leakage into native host args
- native host CI flakiness
- Node.js path discovery in CI
- module cache pollution in browser tests

---

## Skills, Learn, and Skill Mentions

The skills system is much more prominent in 0.9.0.

### `/learn`

The `/learn` command evolved from search/install into an LLM-assisted advisor:

- project analysis
- skill recommendation
- skill generation
- project-hash metadata for update tracking
- `learn recommend`, `learn update`, and `learn generate` RPC handlers
- progress callbacks for step logging
- modal pause/resume lifecycle
- blinking progress indicator
- full catalog visibility for better recommendations

### `/skills`

Search, trending, remove, and feedback routes moved from `/learn` into `/skills`, giving a clearer split:

- `/learn` analyzes the project and recommends/generates skills.
- `/skills` manages catalog operations and installed skills.

### Skill Safety

New skill safety work includes:

- `SkillSecurityScanner`
- two-layer threat detection
- security scores on community skill metadata
- pre-learn and post-learn hook events
- skill event telemetry

### Skill Discovery Tools

The agent now has tool definitions and implementation for finding agent skills. The `/learn` advisor uses that tool path for discovery instead of embedding large skill catalogs directly into prompts.

---

## Code Review Workflows

0.9.0 gives code review a dedicated surface.

### Slash Commands and Tools

- Added `/review` with a bundled code-reviewer skill.
- Added `/pr-review` for PR-oriented review flows.
- Added `code_review` action type.
- Registered `code_review` tool definition.
- Implemented code-review action execution.
- Added review hook events.
- Made `/review` work in RPC and ACP modes.
- Added queue instruction support to slash command context.

### Hook Lifecycle

The review action fires hook lifecycle events and passes environment/context data so external integrations can observe and extend review behavior.

---

## Recurring Work and Scheduling

Autohand can now schedule future work.

### `/repeat` and `--repeat`

- `/repeat` slash command for recurring prompt scheduling.
- `--repeat` CLI flag for non-interactive recurring mode.
- Autocomplete metadata for repeat subcommands.
- Guidance for canceling scheduled work.
- Triggered jobs auto-run in non-interactive modes.

### Schedule Tools

- `list_schedules` tool.
- `cancel_schedule` tool.
- cron create and delete tools.
- `schedule_triggered` event for ACP and RPC clients.

---

## Automation, Parallel Tools, and Orchestration

0.9.0 adds the foundation for more agentic execution.

### Parallel Tool Execution

The branch adds:

- parallel tool execution engine
- concurrency control
- depth-scaled subagent concurrency
- grouped batch rendering for parallel output
- performance benchmarks
- tests for parallel execution

Mutating tools are serialized for safety, while read-only and independent work can execute concurrently.

### Project and Team Tools

New tool categories include:

- project tracker tool for GitHub issues and PRs
- team task management tools
- worktree session enter and exit tools
- notebook cell editing tools
- skill and sleep orchestration tools
- delegation and tool discovery guidance

### Agent Runtime Refactor

The current branch extracts the agent into clearer modules:

- orchestration modules
- interactive lifecycle
- UI runtime
- command runtime
- session accounting
- context runtime
- tool output runtime
- project operations
- typed instruction runner
- tool loop signature helpers

This refactor should make future feature work easier to review and safer to test.

---

## Shell, Search, File, and Workspace Tools

### Shell and Command Execution

Shell handling became more realistic:

- `run_command` now prefers shell execution for shell operators.
- background shell command support was added.
- `run_command` and `shell` are included in default yolo tools where appropriate.
- non-git directories return actionable messages instead of throws.
- shell commands avoid sync execution from the interactive prompt.
- missing `xdg-open` and malformed local-provider shell failures are handled more cleanly.

### Search and Glob

- Added a ripgrep-powered `glob` tool.
- Added utilities for resolving bundled ripgrep.
- Later migrated search tools toward the FFF adapter.
- Aligned the FFF Bun adapter with the native result API.
- Consolidated search tools into a unified `find` tool.

### File Mutation and Workspace Expansion

- File-modified hooks now fire with change type metadata.
- Diff display is available for mutation tools.
- Workspace access can be dynamically requested for directories outside the default root.
- Path resolution was hardened with symlink protection and allowed additional directories.
- `multi_file_edit` now uses fuzzy matching for whitespace differences.
- Patch application was fixed to honor original values during replacements.

---

## Plan Mode, Auto Mode, and Non-Interactive Behavior

### Plan Mode

Plan mode now behaves more like a deliberate workflow:

- `/plan` and Shift+Tab behavior are unified in the Ink TUI.
- Plan mode gets a dedicated visual state.
- The plan tool is gated behind plan mode.
- Plan instructions were strengthened to prevent LLM looping.
- Added `exit_plan_mode` tool for a cc-src-style plan workflow.
- Plan mode instructions only appear when plan mode is enabled.

### Auto Mode

Auto mode and yes-mode behavior were tightened:

- auto-mode defaults to non-interactive completion unless handoff is requested
- auto-commit is auto-approved in yes and non-interactive modes
- follow-up questions can be auto-answered in yes mode
- `/automode on/off` toggles interactive auto-mode
- `--yolo` is processed before RPC runtime creation
- commit-message modal respects `--yolo`

---

## Permissions and Workspace Safety

0.9.0 makes permissions more consistent and more explicit.

### Permission Changes

- More aggressive and persistent permission checks keep users in control.
- Prefix-based folder permissions were fixed so directories are considered correctly, not only files.
- Default yolo file-tool behavior is honored.
- Permission mode precedence was fixed.
- File tool defaults can be overridden in non-interactive flows.
- Agent permission changes are captured more explicitly.
- Tool suggestions can derive allowed tools from user permission config.

### Safety Gates

- Context compaction and safety gates were strengthened.
- Action executor validation and error handling were hardened.
- Image payload size limits prevent request overflow.
- Large pasted blocks are capped before rendering.
- Expected operational errors are filtered out of auto-reporting.

---

## Context, Memory, and Session Accounting

Context management received both product and architecture work.

### Context Compaction

- Context compaction was improved and then extracted into `src/core/context/`.
- Conversation management was hardened.
- Memory injection is trimmed during session bootstrap.
- Model context windows were refreshed for newer model IDs.
- Image compression moved to a multi-stage pipeline.

### Session Lifecycle

- Sessions await cleanup before shutdown on interactive exit.
- Idle logout can close the active session after inactivity.
- Close-session handling now tears down the Ink composer before printing exit output.
- Session diff line statistics are computed for richer status rendering.
- Session diff tracking now allows a longer Git command timeout for larger repositories.

---

## Hooks, ACP, RPC, and SDK-Facing Surfaces

### Hooks

New and improved hook events include:

- hook notification emission in ACP for Zed parity
- review hook events
- code review action hooks
- file-modified hooks with change type
- mode-change hook event
- pre-learn and post-learn events

Hook output is routed through prompt notifications to avoid composer interleaving.

### ACP and RPC

ACP and JSON-RPC support grew across:

- `/learn` methods
- `/skills` methods
- `/review`
- browser bridge output
- schedule triggered events
- setup command support
- provider/model defaults
- `getSession`
- `--acp` shorthand flag

The current branch also refreshes ACP available models and default model resolution.

---

## Onboarding, Setup, and Configuration

### Setup Wizard

The setup wizard now covers more real-world paths:

- provider-specific setup for Azure, Vertex AI, xAI, Cerebras, NVIDIA, and DeepSeek
- OpenAI auth mode selection
- optional and mandatory registration flows
- provider-specific model selection
- reusing existing provider values when changing settings
- API-key URL guidance
- language and theme modal lifecycle fixes

### Config Loading

Config handling is more forgiving and more complete:

- JSON configs with a UTF-8 byte order mark can load.
- Empty and malformed config files produce recovery suggestions.
- Config can reload from changed settings for VS Code and Zed integrations.
- Git-loaded config behavior was improved.
- DeepSeek config now receives its default base URL.

### New CLI Flags and Commands

Notable additions include:

- `--setup`
- `--chrome`
- `--no-chrome`
- `--repeat`
- `--settings`
- `--acp`
- `--feedback`

---

## Install, Release, and Bundled Runtime Improvements

0.9.0 includes work to make install and release more reliable:

- automated npm publishing workflow
- release workflow YAML fixes
- tarball bundle installs with checksum verification
- bundled ripgrep support
- platform-specific ripgrep target fixes for Linux and Windows
- Bun 2.0 CI action update
- removal of obsolete Ink compatibility patches
- deterministic proof behavior without auto-installs

---

## Documentation and Examples

The docs were expanded across product, integration, and developer surfaces:

- refreshed README overview, features, flags, commands, troubleshooting, and roadmap
- Autohand Code CLI branding refresh
- Chrome integration docs
- Go SDK documentation
- provider docs refresh
- config reference updates
- shell tool analysis
- cc-src tool gap analysis matrix
- project tracker design and implementation plans
- Ink line extension docs and session diff line extension example
- extending guide linked from README
- `$skill`, shell command, and tool category docs
- sharing feature details

The current branch also updates model examples in provider docs, Go SDK docs, and previous release docs so examples reference the newer model families used by the codebase.

---

## Reliability, Testing, and CI

This release train contains a large amount of test and proof hardening.

### Test Stability

- Vitest configured for stable single-thread execution.
- Proof suite timeouts stabilized.
- Browser/native host tests became more deterministic.
- CI skips or diagnostics were added for Node.js/native host edge cases.
- Module cache pollution causing test failures was fixed.
- Device auth mocks reset between tests.
- Tests were updated after Ink 7 and dependency upgrades.
- Existing test suites were updated to match new provider/model behavior.

### Runtime Stability

- Raw-mode calls are wrapped safely.
- Bad file descriptor and EIO failures are handled during teardown.
- Modal input and bracketed paste handling were hardened.
- Terminal resize no longer aggressively clears the screen.
- Composer output avoids flicker, ghost artifacts, stale status text, and chat-log loss.
- Error classification no longer mislabels provider/model errors as context overflow.
- Provider errors are sanitized before display.

---

## Current 0.9.0 Branch Work

The current uncommitted branch state adds and documents the last release slice before this note:

### DeepSeek Provider

- New `DeepSeekProvider`.
- DeepSeek default base URL.
- Model list with V4 Flash, V4 Pro, `deepseek-chat`, and `deepseek-reasoner`.
- DeepSeek configuration type.
- Provider factory creation and validation.
- Config parser support.
- Setup wizard and `/model` flow.
- DeepSeek i18n strings.
- README, config reference, and providers docs updates.
- Dedicated provider tests and onboarding persistence tests.

### Model and Docs Refresh

- OpenRouter default model changed to `openrouter/auto` for fresh config.
- Legacy OpenRouter config normalization maps to a newer Claude Sonnet model.
- ACP popular model list was refreshed.
- Provider docs and Go SDK examples now use newer model IDs.
- Context and vision tests were updated for newer Claude, GPT, Gemini, and DeepSeek names.

### TUI Cleanup and Exit Rendering

- Ink renderer stop now clears the last frame before unmounting.
- Modal pause now uses safe raw-mode handling.
- Agent close-session cleanup tears down UI before final exit output.
- Tests cover raw-mode failure tolerance, stop cleanup order, and close-session behavior.

### Config Parser Robustness

- JSON config files with a UTF-8 byte order mark now load successfully.
- Tests cover BOM parsing and DeepSeek default base URL behavior.

---

## Migration Notes

### Provider Config

If you use a cloud provider, confirm that your active provider section exists in `~/.autohand/config.json`, `config.toml`, `config.yaml`, or `config.yml`.

DeepSeek users can add:

```json
{
  "provider": "deepseek",
  "deepseek": {
    "apiKey": "your-deepseek-api-key",
    "baseUrl": "https://api.deepseek.com",
    "model": "deepseek-v4-flash"
  }
}
```

OpenAI users can choose either API key or ChatGPT account authentication during setup.

### Ink TUI

Ink is the default TUI. If you have automation that depended on older terminal rendering quirks, re-check:

- slash command output
- modal keyboard navigation
- `Ctrl+C` behavior
- paste handling
- multiline input
- queue editing

### Permissions

Permission checks are stricter and more persistent. Workflows that write outside the workspace may now request directory access instead of silently proceeding.

### Scheduling

Use `/repeat` for interactive scheduling and `--repeat` for non-interactive recurring mode. Use schedule tools or repeat subcommands to inspect and cancel existing schedules.

---

## Known Compatibility Notes

- Ink must remain `>=7.0.0`.
- React must remain `>=19`.
- Existing scripts and tests assume Bun and Vitest.
- Some native-host browser tests are sensitive to CI Node.js availability and may be skipped when the runtime cannot be discovered.
- Provider docs follow the model IDs expected by the current codebase; custom provider/model configurations should continue to work through explicit config.

---

## Full Change Inventory

This is the high-level inventory of changes since `v0.8.0`, grouped by area.

### User Experience

- default Ink TUI
- welcome/login screen
- dynamic welcome suggestions
- idle logout
- slash command dropdowns
- subcommand autocomplete
- inline ghost text
- file mentions
- skill mentions
- command queue browser
- multiline composer
- paste handling
- resize stability
- theme-aware composer box
- user message styling
- visible `/help`, `/about`, `/clear`, `/new`
- memory storage through `#`
- status line extensions
- session diff line stats

### Providers and Models

- Azure
- Vertex AI
- Z.ai
- xAI
- Cerebras
- NVIDIA
- DeepSeek
- ChatGPT auth
- OpenAI API-key setup polish
- OpenRouter model defaults
- provider-specific auth errors
- model capability registry
- image support detection
- sanitized provider errors
- local-provider timeout and retry improvements

### Commands

- `/setup`
- `/review`
- `/pr-review`
- `/repeat`
- `/automode`
- `/chrome`
- `/learn`
- `/skills`
- `/plan` improvements
- `/model` provider expansion

### Tools

- browser tools
- `browser_execute_js`
- `code_review`
- `glob`
- unified `find`
- project tracker
- team task management
- schedule create/delete/list/cancel
- worktree enter/exit
- notebook cell editing
- skill discovery
- sleep
- delegation guidance
- parallel tool execution
- background shell execution
- dynamic directory access request

### Integrations

- Chrome extension bridge
- native host stability
- ACP hook notifications
- RPC learn/skills/setup/review/schedule surfaces
- Zed parity improvements
- VS Code/Zed config reload behavior
- Go SDK docs

### Safety and Reliability

- mandatory login
- registration retry
- stricter permissions
- workspace path validation
- symlink-safe path resolution
- context compaction hardening
- image payload limits
- large paste limits
- robust error classification
- raw-mode safety
- EIO teardown handling
- no sync shell execution from prompt
- deterministic proof/tests

### Architecture

- `src/core/context/` extraction
- agent orchestration modules
- interactive lifecycle module
- UI runtime module
- command runtime module
- session accounting module
- context runtime module
- tool output runtime module
- project operations module
- typed instruction runner
- tool loop signature helpers
- provider architecture capability detection
- reusable display utilities
- themed UI helpers

0.9.0 is therefore not a single feature release. It is the release where the CLI's interactive surface, provider matrix, browser bridge, skills system, automation tools, and internal architecture all moved into a much more production-ready shape.
