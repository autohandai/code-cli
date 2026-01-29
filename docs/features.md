# Autohand CLI Features

Autohand is an autonomous LLM-powered coding agent designed to work directly in your terminal.

---

## Core Intelligence
- [x] **Autonomous Agent**: ReAct (Reasoning + Acting) loop for complex coding tasks
- [x] **Multi-Model Support**: OpenRouter integration (Claude, GPT-4, Grok, etc.)
- [x] **Local Providers**: Ollama, llama.cpp, MLX support via `~/.autohand/config.json`
- [x] **Context Awareness**: Automatic project structure analysis

## Interactive Experience
- [x] Slash suggestions (type `/` for commands)
- [x] File mentions (type `@` for file autocomplete)
- [x] Rich terminal UI with status bar, spinners, colored output
- [x] Graceful error handling (ESC cancellation, invalid inputs)
- [x] Progress indicators (spinners)
- [x] Undo for file changes (via undoStack)
- [x] Responsive layout adapting to terminal size
- [x] Theme support (dark/light in config)
- [x] Syntax-highlighted code blocks
- [x] Interactive diff viewer (accept/reject/edit)
- [ ] Redo for file changes
- [ ] Search history and command palette

## Session Management
- [x] Auto-save to `~/.autohand/sessions`
- [x] Resume with `/resume` or `autohand resume <id>`
- [x] History tracking (interactions, tool outputs, agent thoughts)

## Slash Commands
| Command | Description |
|---------|-------------|
| `/quit` | Exit the current session |
| `/model` | Switch LLM models |
| `/session` | Show current session details |
| `/sessions` | List past sessions |
| `/resume` | Resume a previous session |
| `/new` | Start fresh conversation |
| `/undo` | Revert git changes and last turn |
| `/memory` | View stored memories |
| `/init` | Create `AGENTS.md` file |
| `/agents` | List sub-agents |
| `/agents-new` | Create new agent via wizard |
| `/feedback` | Send feedback |
| `/help` | Display help |
| `/about` | Show information about Autohand |
| `/formatters` | List available code formatters |
| `/lint` | List available code linters |
| `/completion` | Generate shell completion scripts |
| `/export` | Export session to markdown/JSON/HTML |

## Memory System
- [x] Project memory in `.autohand/memory/`
- [x] User memory in `~/.autohand/memory/`
- [x] `#` trigger to store memories
- [x] Similarity detection (update vs duplicate)
- [x] Context injection for personalized responses

## Feedback System
- [x] Smart triggers (after tasks, on session end, gratitude detection)
- [x] Quick 1-5 ratings
- [x] Adaptive prompting with cooldowns
- [x] Follow-up questions based on rating
- [x] Local storage in `~/.autohand/feedback/`
- [x] Manual `/feedback` command

## Telemetry & Analytics
- [x] Opt-in telemetry collection (via `~/.autohand/config.json`)
- [x] Session tracking (start, end, duration)
- [x] Tool usage analytics (success/failure, duration)
- [x] Error tracking with sanitized stack traces
- [x] Model switch tracking
- [x] Slash command usage
- [x] Offline batching (syncs when back online)
- [x] Session cloud sync (resume from any device)
- [x] Privacy-first: no PII, anonymous device IDs

## Sub-Agent Architecture
- [x] Agent registry from `~/.autohand/agents/`
- [x] Task delegation (`delegate_task`)
- [x] Parallel execution up to 5 agents (`delegate_parallel`)
- [x] `/agents` command for discovery

## Tool System
- [x] File system: read, write, edit, create, delete, move, copy
- [x] Search: ripgrep, semantic search, symbol lookup
- [x] Git: status, diff, commit, branch, merge, rebase, cherry-pick, stash, worktree, remotes
- [x] Shell execution with output streaming
- [x] Package manager: npm add/remove with dev flag
- [x] Tool permission system for sensitive operations

## Git Integration
- [x] Status, diff, checkout, apply patch
- [x] Branch operations (create, switch, delete)
- [x] Stash operations (stash, pop, apply, drop, list)
- [x] Cherry-pick with abort/continue
- [x] Rebase with abort/continue/skip
- [x] Merge with abort
- [x] Commit, add, reset
- [x] Remote operations (fetch, pull, push)
- [x] Worktree management (list, add, remove)
- [x] Advanced worktree automation (status, cleanup, parallel commands, sync, PR review)

## Planning & Execution
- [x] Multi-step plan generation
- [x] Dry-run mode

---

## Developer Tools
- [x] Code formatting integration (prettier, black, rustfmt, gofmt, clang-format, shfmt)
- [x] Code linting integration (eslint, pylint, ruff, clippy, golangci-lint, shellcheck)
- [x] Shell completion scripts (bash, zsh, fish)
- [x] Session export to markdown, JSON, and HTML

## Planned Features

### High Priority
- [ ] Streaming text output with typewriter effect

### Medium Priority
- [ ] Plan modification (user can edit plans before execution)
- [ ] Watch mode (auto-refresh on file changes)
- [ ] Checkpoint system (save state between steps)
- [ ] Rollback mechanism for failed operations
- [ ] HTTP client tool for API requests
- [ ] Redo for file changes
- [ ] Search history and command palette

### Future Considerations
- [ ] LSP integration (go-to-definition, find-references)
- [ ] Database tools (query execution, schema inspection)
- [ ] Docker tools (build, run, inspect, logs)
- [ ] VS Code extension
- [ ] CI/CD integration examples
- [ ] Team workspaces with shared context

---

## Platform Support
- [x] macOS
- [x] Linux
- [x] Windows

## Security & Permissions
- [x] Confirmation prompts for destructive operations
- [x] Permission system with whitelist/blacklist
- [x] Three permission modes: `interactive` (default), `unrestricted`, `restricted`
- [x] Pattern-based whitelist (e.g., `run_command:npm *`)
- [x] Pattern-based blacklist (e.g., `run_command:rm -rf *`)
- [x] CLI flags: `--unrestricted` and `--restricted`
- [x] **Local project permissions** (`.autohand/settings.local.json`)
  - Approve once, don't ask again for this project
  - Per-file and per-command whitelisting
  - Merged with global settings (local takes priority)
- [x] File operation approval prompts (edit, write, delete)
- [ ] Audit log of tool executions
- [ ] Secret redaction in outputs

## Performance & Reliability
- [x] Response streaming for immediate feedback
- [x] Automatic request retry with exponential backoff (configurable, max 5)
- [x] Request timeout configuration
- [x] User-friendly error messages (no raw provider errors exposed)
- [ ] Caching layer for repeated tool calls
- [ ] Lazy loading of tools
