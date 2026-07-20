# Autohand Code CLI

[![Bun](https://img.shields.io/badge/Bun-%23c61f33?style=flat&logo=bun&logoColor=white)](https://bun.sh)
[![Discord](https://img.shields.io/badge/Discord-Join%20Us-%235865F2?style=flat&logo=discord&logoColor=white)](https://discord.gg/ZM3TCtwCwG)

[Follow us on X](https://x.com/autohandai) | [Join Discord](https://discord.gg/ZM3TCtwCwG)

Docs: [English](docs/config-reference.md) | [日本語](docs/config-reference_ja.md) | [简体中文](docs/config-reference_zh.md) | [繁體中文](docs/config-reference_zh-tw.md) | [한국어](docs/config-reference_ko.md) | [Deutsch](docs/config-reference_de.md) | [Español](docs/config-reference_es.md) | [Français](docs/config-reference_fr.md) | [Italiano](docs/config-reference_it.md) | [Polski](docs/config-reference_pl.md) | [Русский](docs/config-reference_ru.md) | [Português (Brasil)](docs/config-reference_ptBR.md) | [Türkçe](docs/config-reference_tr.md) | [Čeština](docs/config-reference_cs.md) | [Magyar](docs/config-reference_hu.md) | [हिन्दी](docs/config-reference_hi.md) | [Bahasa Indonesia](docs/config-reference_id.md)

**A fast, self-improving terminal-native AI coding agent for planning, reflecting, remembering, editing, testing, and automating work across your codebase.**

Autohand Code CLI is a fast, terminal-native AI coding agent that lives where you already work. It reads project context, plans changes, edits files, runs tools, and asks for approval before risky operations.

The interface is built for focused interactive sessions: minimal chrome, smooth Ink rendering, file mentions, slash commands, skills, permissions, provider switching, and session history all available from one prompt.

Install it, run `autohand`, and describe the outcome you want in natural language. Use Autohand Code CLI locally, with your editor, or in CI/CD to automate repetitive engineering work without giving up control.

![Autohand Code CLI running in the terminal](docs/gif/autohand-intro.gif)

## Features

- **Terminal-Native Agent**: Understands your codebase and executes approved changes from the CLI
- **Planning + Tools**: Combines reasoning, file edits, shell commands, and web context in one loop
- **Interactive REPL**: Smooth terminal experience with file mentions, slash commands, and keyboard shortcuts
- **Modular Skills**: Extends workflows with specialized instruction packages
- **Multi-Provider Support**: Works with OpenRouter, LLMGateway, OpenAI, AWS Bedrock, DeepSeek, Azure Foundry Models, Z.ai, and local models
- **Git Integration**: Full version control support with automatic commits
- **Cross-Platform**: Works on macOS, Linux, and Windows

## Why Autohand Code CLI?

- **No Context Switching**: Stay in your terminal, no copy-paste needed
- **Intelligent Planning**: Understands your codebase before making changes
- **Safe Execution**: Prompts before risky operations unless you choose a different permission mode
- **Extensible**: Add skills, hooks, and provider configuration as your workflow grows
- **Fast**: Optimized for responsive interactive sessions and efficient tool execution

## Installation

### Quick Install (Recommended)

```bash
curl -fsSL https://autohand.ai/install.sh | bash
```

### Homebrew

```bash
brew install autohandai/code/autohand-code
```

The fully qualified command installs and trusts only the Autohand formula. Start the CLI with `autohand`; the previous `autohand-code` command remains available as an alias.

### Manual Installation

```bash
# Clone and build
git clone https://github.com/autohandai/code-cli.git
cd code-cli
bun install
bun run build

# Install globally
bun add -g .
```

### Requirements

- Bun ≥1.0 (`curl -fsSL https://bun.sh/install | bash`)
- Git (for version control features)
- ripgrep (optional, for faster search)

## Quick Start

```bash
# Interactive mode - start a coding session
autohand

# Command mode - run a single instruction
autohand -p "add a dark mode toggle to the settings page"

# With auto-confirmation
autohand -p "fix the TypeScript errors" -y

# Auto-commit changes after task completion
autohand -p "refactor the auth module" -c
```

## Editor Extensions

Use Autohand Code CLI directly in your favorite editor:

### VS Code

Install the extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=AutohandAI.vscode-autohand) or via command line:

```bash
code --install-extension AutohandAI.vscode-autohand
```

### Zed Editor

Run Autohand Code CLI as a native ACP External Agent. See the [ACP integration guide](docs/guides/ACP.md) for Zed, JetBrains IDEs, JetBrains Air, and other ACP-compatible development environments.

## Code Agent SDK

Developers can also build on the same CLI-backed agent runtime through the [Code Agent SDK](https://github.com/autohandai/code-agent-sdk-typescript). Use it when you want Autohand Code CLI capabilities inside your own tools, services, workflows, or editor integrations.

The Agent SDK is available in multiple beta language packages. Use the same CLI-backed SDK model from another programming language:

- TypeScript - this package, with Agent, Run, streaming, and JSON helpers.
- Go - idiomatic Go package with context.Context, typed events, and channel-based streaming.
- Python - async Python package with async for event streams and typed Pydantic models.
- Java - Java 21 records, sealed events, and virtual-thread-ready APIs.
- Swift - SwiftPM package with Agent, Runner, async streams, tools, hooks, and permissions.

## Usage Modes

### Interactive Mode

Launch without arguments for a full REPL experience:

```bash
autohand
```

Features:

- Type `/` for slash command suggestions
- Type `@` for file autocomplete (e.g., `@src/index.ts`)
- Type `$` for skill autocomplete (e.g., `$frontend-design`)
- Type `!` to run terminal commands (e.g., `! git status`, `! ls -la`)
- **Smart Paste**: Paste any amount of code (5+ lines shows compact indicator, full content sent to LLM)
- Press `ESC` to cancel in-flight requests
- Press `Ctrl+C` twice to exit
- Press `Shift+Tab` to toggle plan mode
- Press `?` to toggle keyboard shortcuts panel
- Press `Enter` or `Shift+Enter` for newlines in multi-line input

### Command Mode (Non-Interactive)

Run single instructions for CI/CD, scripts, or quick tasks:

```bash
# Basic usage
autohand --prompt "add tests for the user service"

# Short form
autohand -p "fix linting errors"

# With options
autohand -p "update dependencies" --yes --auto-commit

# Dry run (preview changes without applying)
autohand -p "refactor database queries" --dry-run
```

### CLI Options

| Option                          | Short | Description                                                                      |
| ------------------------------- | ----- | -------------------------------------------------------------------------------- |
| `--prompt <text>`               | `-p`  | Run a single instruction in command mode                                         |
| `--yes`                         | `-y`  | Auto-confirm risky actions                                                       |
| `--auto-commit`                 | `-c`  | Auto-commit changes after completing tasks                                       |
| `--dry-run`                     |       | Preview actions without applying mutations                                       |
| `--debug`                       | `-d`  | Enable debug output (verbose logging)                                            |
| `--model <model>`               |       | Override the configured LLM model                                                |
| `--path <path>`                 |       | Workspace path to operate in                                                     |
| `--auto-skill`                  |       | Auto-generate skills based on project analysis                                   |
| `--unrestricted`                |       | Run without approval prompts (use with caution)                                  |
| `--restricted`                  |       | Deny all dangerous operations automatically                                      |
| `--no-idle-logout`              |       | Disable authenticated idle logout for long-running agent sessions                |
| `--config <path>`               |       | Path to config file                                                              |
| `--temperature <value>`         |       | Sampling temperature for LLM                                                     |
| `--thinking [level]`            |       | Set thinking/reasoning depth (none, normal, extended)                            |
| `--learn`                       |       | Run skill advisor non-interactively                                              |
| `--learn-update`                |       | Re-analyze project and regenerate skills                                         |
| `--skill-install [name]`        |       | Install a community skill                                                        |
| `--project`                     |       | Install skill to project level (with --skill-install)                            |
| `--permissions`                 |       | Display current permission settings and exit                                     |
| `--login`                       |       | Sign in to your Autohand Code account                                            |
| `--logout`                      |       | Sign out of your Autohand Code account                                           |
| `--sync-settings [bool]`        |       | Enable/disable settings sync (default: true for logged users)                    |
| `--patch`                       |       | Generate git patch without applying changes                                      |
| `--output <file>`               |       | Output file for patch (default: stdout)                                          |
| `--mode <mode>`                 |       | Run mode: interactive (default), rpc, or acp                                     |
| `--acp`                         |       | Shorthand for --mode acp (Agent Client Protocol over stdio)                      |
| `--teammate-mode <mode>`        |       | Team display mode: auto, in-process, or tmux                                     |
| `--worktree [name]`             |       | Run session in isolated git worktree (optional name)                             |
| `--tmux`                        |       | Launch in a dedicated tmux session (implies --worktree)                          |
| `--auto-mode [prompt]`          |       | Enable interactive auto-mode, or start standalone loop with inline task          |
| `--max-iterations <n>`          |       | Max auto-mode iterations (default: 50)                                           |
| `--completion-promise <text>`   |       | Completion marker text (default: "DONE")                                         |
| `--no-worktree`                 |       | Disable git worktree isolation in auto-mode                                      |
| `--checkpoint-interval <n>`     |       | Git commit every N iterations (default: 5)                                       |
| `--max-runtime <m>`             |       | Max runtime in minutes (default: 120)                                            |
| `--max-cost <d>`                |       | Max API cost in dollars (default: 10)                                            |
| `--interactive-on-complete`     |       | After auto-mode ends, hand off to interactive mode (TTY only)                    |
| `--setup`                       |       | Run the setup wizard to configure or reconfigure Autohand Code CLI               |
| `--about`                       |       | Show information about Autohand Code CLI                                         |
| `--add-dir <path...>`           |       | Add additional directories to workspace scope (can be used multiple times)       |
| `--display-language <locale>`   |       | Set display language (e.g., en, id, zh-cn, fr, de, ja)                           |
| `--cc, --context-compact`       |       | Enable context compaction (default: on)                                          |
| `--no-cc, --no-context-compact` |       | Disable context compaction                                                       |
| `--search-engine <provider>`    |       | Set web search provider (browser-profile, exa, google, brave, duckduckgo, parallel) |
| `--sys-prompt <value>`          |       | Replace entire system prompt (inline string or file path)                        |
| `--append-sys-prompt <value>`   |       | Append to system prompt (inline string or file path)                             |
| `--yolo [pattern]`              |       | Auto-approve tool calls matching pattern (e.g., allow:read,write or deny:delete) |
| `--timeout <seconds>`           |       | Timeout in seconds for auto-approve mode                                         |
| `--settings`                    |       | Configure Autohand Code CLI settings (same as /settings in interactive mode)     |
| `--feedback`                    |       | Submit feedback                                                                  |
| `--chrome`                      |       | Enable Chrome browser integration (same as /browser)                             |
| `--no-chrome`                   |       | Disable Chrome browser integration                                               |

## Agent Skills

Skills are modular instruction packages that extend Autohand Code CLI with specialized workflows. They work like on-demand `AGENTS.md` files for specific tasks.

### Using Skills

```bash
# List available skills
/skills

# Activate a skill
/skills use changelog-generator

# Create a new skill interactively
/skills new

# Auto-generate project-specific skills
autohand --auto-skill
```

### Auto-Skill Generation

Analyze your project and generate tailored skills automatically:

```bash
$ autohand --auto-skill
Analyzing project structure...
Detected: typescript, react, nextjs, testing
Platform: darwin
Generating skills...
  ✓ nextjs-component-creator
  ✓ typescript-test-generator
  ✓ changelog-generator

✓ Generated 3 skills in .autohand/skills
```

Skills are discovered from:

- `~/.autohand/skills/` - User-level skills
- `<project>/.autohand/skills/` - Project-level skills
- [skilled.autohand.ai](https://skilled.autohand.ai) - Community skill registry
- Compatible with Codex and Claude skill formats

See [Agent Skills Documentation](docs/agent-skills.md) for creating custom skills.

## Slash Commands

| Command            | Description                                                                      |
| ------------------ | -------------------------------------------------------------------------------- |
| `/help`            | Display available commands                                                       |
| `/?`               | Alias for /help                                                                  |
| `/quit`            | Exit the session                                                                 |
| `/exit`            | Exit the session                                                                 |
| `/model`           | Switch LLM models                                                                |
| `/new`             | Start fresh conversation                                                         |
| `/clear`           | Clear conversation history                                                       |
| `/undo`            | Revert last changes                                                              |
| `/session`         | Show current session details                                                     |
| `/sessions`        | List past sessions                                                               |
| `/resume`          | Resume a previous session                                                        |
| `/memory`          | View/manage stored memories                                                      |
| `/init`            | Create `AGENTS.md` file                                                          |
| `/agents`          | Show active Autohand CLI instances                                               |
| `/agents definitions` | List configured sub-agents                                                    |
| `/agents-new`      | Create new agent via wizard                                                      |
| `/skills`          | List and manage skills                                                           |
| `/skills new`      | Create a new skill                                                               |
| `/skills use`      | Activate a skill                                                                 |
| `/skills install`  | Install a community skill                                                        |
| `/skills search`   | Search for skills                                                                |
| `/skills trending` | List trending skills                                                             |
| `/skills remove`   | Remove an installed skill                                                        |
| `/learn`           | Get skill recommendations                                                        |
| `/feedback`        | Send feedback                                                                    |
| `/formatters`      | List code formatters                                                             |
| `/lint`            | List code linters                                                                |
| `/completion`      | Generate shell completion scripts                                                |
| `/export`          | Export session to markdown/JSON/HTML                                             |
| `/status`          | Show workspace status                                                            |
| `/usage`           | Show token activity by day, week, or month                                       |
| `/login`           | Authenticate with Autohand Code API                                              |
| `/logout`          | Sign out                                                                         |
| `/permissions`     | Manage tool permissions                                                          |
| `/hooks`           | Manage git hooks                                                                 |
| `/experiments`     | Toggle experimental feature switches                                             |
| `/settings`        | View configuration settings                                                      |
| `/theme`           | Change UI theme                                                                  |
| `/language`        | Change display language                                                          |
| `/cc`              | Toggle context compaction                                                        |
| `/search`          | Search the web                                                                   |
| `/deep-research`   | Run cited research; use `status` for progress (`/deep-search` alias)             |
| `/publish-research`| Preview and publish a saved research report with explicit confirmation             |
| `/automode`        | Manage auto-mode                                                                 |
| `/autoresearch`    | Run replayable benchmark loops with history, replay, comparison, and Pareto analysis |
| `/goal`            | Set, review, or refine the current session goal                                  |
| `/goal writer`     | Draft one or more well-specified goals with the built-in `$goal-writer` skill    |
| `/squad`           | Open/manage the local Autohand Squad runtime                                     |
| `/go`              | Pair this session with the Autohand Code iOS app                                 |
| `/sync`            | Sync settings across devices                                                     |
| `/add-dir`         | Add additional workspace directory                                               |
| `/plan`            | Create a task plan                                                               |
| `/about`           | Show information about Autohand Code CLI                                         |
| `/ide`             | Open in IDE                                                                      |
| `/history`         | View command history                                                             |
| `/mcp`             | Manage MCP servers                                                               |
| `/mcp install`     | Install community MCP servers                                                    |
| `/team`            | Manage team collaboration                                                        |
| `/tasks`           | List team tasks                                                                  |
| `/message`         | Send team message                                                                |
| `/import`          | Import data from Claude, Codex, Gemini, Cursor, OpenCode, Kimi, and other agents |
| `/repeat`          | Repeat previous actions                                                          |
| `/browser`         | Browser integration                                                              |
| `/review`          | Code review                                                                      |

`/go --steer` and `/handoff session --steer` keep the paired iOS app updated
with permission/change requests and read-only GitHub delivery metadata. While a
relay is active, the CLI publishes the current pull request, checks, and GitHub
deployment records when available; missing `gh` authentication does not stop
the coding session. On macOS, steer handoff also keeps the computer awake with
a CLI-owned `caffeinate` process; the paired phone can turn that assertion on
or off, and it is always released when the relay stops or the CLI exits.
Ready pull requests can be squash merged from the paired phone after a second
explicit confirmation. The relay re-fetches the current PR and rejects the
action unless its reviewed number and head branch still match, it remains open
and mergeable, and all reported checks pass. Only then does it run the fixed
`gh pr merge <number> --squash` command and publish the result to mobile.
For mobile-originated completed work, explicitly referenced PNG/JPEG, MP4, and
text/JSON artifacts inside the active workspace can be uploaded to the
authenticated mobile session. Real-path confinement prevents symlink escapes,
and uploads are capped at 12 files and 15 MB per file.

## Tool System

Autohand Code CLI includes 40+ tools for autonomous coding:

### File Operations

`read_file`, `write_file`, `append_file`, `apply_patch`, `search`, `search_replace`, `semantic_search`, `list_tree`, `create_directory`, `delete_path`, `rename_path`, `copy_path`

### Git Operations

`git_status`, `git_diff`, `git_commit`, `git_add`, `git_branch`, `git_switch`, `git_merge`, `git_rebase`, `git_cherry_pick`, `git_stash`, `git_fetch`, `git_pull`, `git_push`, `auto_commit`

### Commands & Dependencies

`run_command`, `custom_command`, `add_dependency`, `remove_dependency`

### Planning & Memory

`plan`, `todo_write`, `save_memory`, `recall_memory`

### Meta Tools

`tools_registry` - List all available tools with descriptions.
`tool_search` - Search tools by capability, name, or description.
`create_meta_tool` - Create reusable user- or project-scoped shell-backed tools that load in future sessions.

### Code Extensions

Package reusable tools and agents in a strict declarative manifest, then validate and install them without changing CLI source:

```sh
autohand extensions validate ./examples/extensions/autohand.code-health
autohand extensions install ./examples/extensions/autohand.code-health
autohand extensions list
```

Extensions execute no code during install or startup. They can contribute tools, focused agents, and portable Agent Skills; contributed tools use the existing permission and hook pipeline when invoked. Mention `$extension-builder` to create, extend, or adapt an extension from a description or Pi package. See the [extension-builder guide and terminal demo](docs/guides/building-autohand-extensions.md), [Using extensions](docs/extensions.md), [Extension authoring](docs/extension-authoring.md), and the [six working examples](examples/extensions).

### Notebooks

`notebook_cell_edit` - Edit Jupyter notebook cells (code/markdown insert, delete, replace).

### Team & Collaboration

`team_create`, `team_list`, `task_create`, `task_list`, `task_update`, `task_set_owner` - Multi-agent team coordination.

### Agent Delegation

`spawn_subagent` - Delegate tasks to focused agents to keep the main context window clean.

### Skills & Browser

`use_skill`, `sleep` - Activate skills or pause execution.
`screenshot`, `navigate`, `get_page_content`, `click`, `type_input`, `select_dropdown` - Chrome browser integration.

## Configuration

Create `~/.autohand/config.json` or use `config.toml`, `config.yaml`, or `config.yml`:

```json
{
  "provider": "openrouter",
  "openrouter": {
    "apiKey": "sk-or-...",
    "model": "your-modelcard-id-here"
  },
  "workspace": {
    "defaultRoot": ".",
    "allowDangerousOps": false
  },
  "ui": {
    "theme": "dark",
    "autoConfirm": false
  }
}
```

### Supported Providers

| Provider    | Config Key   | Notes                                        |
| ----------- | ------------ | -------------------------------------------- |
| OpenRouter  | `openrouter` | Access to Claude, GPT-4, Grok, etc.          |
| LLMGateway  | `llmgateway` | Direct Claude API access                     |
| OpenAI      | `openai`     | GPT-4 and other models                       |
| AWS Bedrock | `bedrock`    | Bedrock Converse and OpenAI-compatible modes |
| DeepSeek    | `deepseek`   | DeepSeek V4 Flash, V4 Pro, reasoning         |
| Ollama      | `ollama`     | Local models                                 |
| llama.cpp   | `llamacpp`   | Local inference                              |
| MLX         | `mlx`        | Apple Silicon optimized                      |
| Z.ai        | `zai`        | High-performance inference                   |

## Session Management

Sessions are auto-saved to `~/.autohand/sessions/`:

```bash
# Resume via command
autohand resume <session-id>

# Or in interactive mode
/resume
```

## Entire Integration

Autohand Code CLI supports [Entire](https://entire.io) for session checkpointing. Entire captures your coding sessions -- prompts, file changes, and token usage -- as git-backed checkpoints that you can rewind to, review, and share.

```bash
# Install hooks in this repository
entire enable --agent autohand-code

# Check status
entire status

# Remove hooks
entire disable --agent autohand-code
```

Once enabled, Entire works automatically through the Autohand Code CLI hooks system. No changes to your workflow are needed. See the [Entire Integration Guide](docs/entire-integration.md) for setup details and troubleshooting.

## Security & Permissions

Autohand Code CLI includes a permission system for sensitive operations:

- **Interactive** (default): Prompts for confirmation on risky actions
- **Unrestricted** (`--unrestricted`): No approval prompts
- **Restricted** (`--restricted`): Denies all dangerous operations

Configure granular permissions in `~/.autohand/config.toml/yaml/json`:

```json
{
  "permissions": {
    "whitelist": ["run_command:npm *", "run_command:bun *"],
    "blacklist": ["run_command:rm -rf *", "run_command:sudo *"]
  }
}
```

## Platform Support

- macOS
- Linux
- Windows

## Telemetry & Feedback

Telemetry is disabled by default. Opt in to help improve Autohand Code CLI:

```json
{
  "telemetry": {
    "enabled": true
  }
}
```

When enabled, Autohand Code CLI collects anonymous usage data (no PII, no code content). See [Telemetry Documentation](docs/telemetry.md) for details.

The backend API is available at: https://github.com/autohandai/api

## Development

```bash
# Install dependencies
bun install

# Development mode
bun run dev

# Build
bun run build

# Type check
bun run typecheck

# Run tests
bun run test
```

## Docker

```dockerfile
FROM oven/bun:1
WORKDIR /app
COPY . .
RUN bun install && bun run build
CMD ["node", "dist/index.js"]
```

```bash
docker build -t autohand .
docker run -it autohand
```

## Documentation

- [Playbook](AUTOHAND_PLAYBOOK.md) - 20 use cases for the software development lifecycle
- [Features](docs/features.md) - Complete feature and experiment list
- [Agent Skills](docs/agent-skills.md) - Skills system guide
- [ACP integration guide](docs/guides/ACP.md) - Use the native ACP agent in compatible editors, IDEs, and ADEs
- [Extending Autohand Code CLI](docs/extending.md) - Build tools, skills, hooks, MCP servers, and integrations
- [Autohand Code extensions](docs/extensions.md) - Validate, install, inspect, and manage declarative extension packages
- [Extension authoring](docs/extension-authoring.md) - Package tools and agents for the public extension ecosystem
- [Model catalog updates](docs/model-catalog.md) - Automatic refresh, offline fallback, Pi-compatible publication, and admin PR workflow
- [Configuration Reference](docs/config-reference.md) - All config options
  - [English](docs/config-reference.md)
  - [日本語](docs/config-reference_ja.md)
  - [简体中文](docs/config-reference_zh.md)
  - [繁體中文](docs/config-reference_zh-tw.md)
  - [한국어](docs/config-reference_ko.md)
  - [Deutsch](docs/config-reference_de.md)
  - [Español](docs/config-reference_es.md)
  - [Français](docs/config-reference_fr.md)
  - [Italiano](docs/config-reference_it.md)
  - [Polski](docs/config-reference_pl.md)
  - [Русский](docs/config-reference_ru.md)
  - [Português (Brasil)](docs/config-reference_ptBR.md)
  - [Türkçe](docs/config-reference_tr.md)
  - [Čeština](docs/config-reference_cs.md)
  - [Magyar](docs/config-reference_hu.md)
  - [हिन्दी](docs/config-reference_hi.md)
  - [Bahasa Indonesia](docs/config-reference_id.md)
- [Entire Integration](docs/entire-integration.md) - Session checkpointing with Entire

## Contributing

We welcome contributions! Please read our [Contributing Guide](CONTRIBUTING.md) for details on how to get involved.

## Troubleshooting

### Common Issues

**Installation fails**: Make sure you have Bun installed and up to date.

**Permission denied**: Check your file permissions and try running with appropriate privileges.

**Model not working**: Verify your API key and model configuration in `~/.autohand/config.toml/yaml/json`.

### Getting Help

- Join our [Discord community](https://discord.gg/ZM3TCtwCwG)
- Check the [documentation](docs/)
- Open an issue on [GitHub](https://github.com/autohandai/code-cli/issues)

## Community

- **Discord**: https://discord.gg/ZM3TCtwCwG
- **GitHub**: https://github.com/autohandai/code-cli
- **Website**: https://autohand.ai
- **X**: [@autohandai](https://x.com/autohandai)

## Security

Autohand Code CLI is designed with security in mind:

- **User-Controlled Execution**: Risky operations require approval unless you opt into a broader permission mode
- **Permission System**: Fine-grained control over what operations are allowed
- **Local Processing**: Your code never leaves your machine unless you choose
- **Open Source**: Transparent code that can be audited

## License

Apache License 2.0 - Free for individuals, non-profits, educational institutions, open source projects, and companies with ARR under $5M. See [LICENSE](LICENSE) and [COMMERCIAL.md](COMMERCIAL.md) for details.

## Links

- Website: https://autohand.ai
- CLI Install: https://autohand.ai/cli/
- GitHub: https://github.com/autohandai/code-cli
- API Backend: https://github.com/autohandai/api
- Discord: https://discord.gg/ZM3TCtwCwG

## Roadmap

### Upcoming Features

- **Enhanced AI Models**: Support for newer models and improved reasoning
- **Plugin System**: Easier way to extend Autohand Code CLI with custom functionality
- **Team Collaboration**: Features for team-based development workflows
- **Advanced Testing**: Automated test generation and execution
- **Code Review**: AI-powered code review and quality checks

### Current Focus

- Improving response times and accuracy
- Expanding skill library with more specialized workflows
- Enhancing the interactive experience with better UI/UX
- Adding more provider integrations
- Strengthening security and permission systems

---

**Ready to get started?** Run `autohand` in your terminal and start a coding session.
