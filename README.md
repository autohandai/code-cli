# Autohand Code CLI

[![Bun](https://img.shields.io/badge/Bun-%23c61f33?style=flat&logo=bun&logoColor=white)](https://bun.sh)
[![Discord](https://img.shields.io/badge/Discord-Join%20Us-%235865F2?style=flat&logo=discord&logoColor=white)](https://discord.com/invite/MWTNudaj8E)

**An autonomous coding agent CLI that reads, reasons, and writes code across your entire project. No context switching. No copy-paste.**

Autohand Code CLI is an autonomous LLM-powered coding agent that lives in your terminal. It uses the ReAct (Reason + Act) pattern to understand your codebase, plan changes, and execute them with your approval. It's blazing fast, intuitive, and extensible with a modular skill system.

We built with a minimalistic design philosophy to keep the focus on coding. Just install, run `autohand`, and start giving instructions in natural language. Autohand handles the rest.

Scale Autohand across your team and CI/CD pipelines to automate repetitive coding tasks, enforce code quality, and accelerate development velocity.

![Alt Autohand in the terminal](docs/gif/autohand-intro.gif)

## Features

- **Autonomous Coding**: Understands your codebase and executes changes with approval
- **ReAct Pattern**: Combines reasoning and action for intelligent code modifications
- **Interactive REPL**: Full terminal experience with file mentions and slash commands
- **Modular Skills**: Extend functionality with specialized instruction packages
- **Multi-Provider Support**: Works with OpenRouter, Anthropic, OpenAI, and local models
- **Git Integration**: Full version control support with automatic commits
- **Cross-Platform**: Works on macOS, Linux, and Windows

## Why Autohand?

- **No Context Switching**: Stay in your terminal, no copy-paste needed
- **Intelligent Planning**: Understands your codebase before making changes
- **Safe Execution**: Requires approval for all modifications
- **Extensible**: Add new skills and customize behavior
- **Fast**: Optimized for quick responses and efficient execution

## Installation

### Quick Install (Recommended)

```bash
curl -fsSL https://autohand.ai/install.sh | bash
```

### Manual Installation

```bash
# Clone and build
git clone https://github.com/autohandai/cli.git
cd cli
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

Use Autohand directly in your favorite editor:

### VS Code

Install the extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=AutohandAI.vscode-autohand) or via command line:

```bash
code --install-extension AutohandAI.vscode-autohand
```

### Zed Editor

Install from the [Zed Extensions](https://zed.dev/extensions/autohand-acp) marketplace.

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

| Option                  | Short | Description                                     |
| ----------------------- | ----- | ----------------------------------------------- |
| `--prompt <text>`       | `-p`  | Run a single instruction in command mode        |
| `--yes`                 | `-y`  | Auto-confirm risky actions                      |
| `--auto-commit`         | `-c`  | Auto-commit changes after completing tasks      |
| `--dry-run`             |       | Preview actions without applying mutations      |
| `--debug`               | `-d`  | Enable debug output (verbose logging)           |
| `--model <model>`       |       | Override the configured LLM model               |
| `--path <path>`         |       | Workspace path to operate in                    |
| `--auto-skill`          |       | Auto-generate skills based on project analysis  |
| `--unrestricted`        |       | Run without approval prompts (use with caution) |
| `--restricted`          |       | Deny all dangerous operations automatically     |
| `--config <path>`       |       | Path to config file                             |
| `--temperature <value>` |       | Sampling temperature for LLM                    |
| `--thinking [level]`    |       | Set thinking/reasoning depth (none, normal, extended) |
| `--learn`               |       | Run skill advisor non-interactively             |
| `--learn-update`        |       | Re-analyze project and regenerate skills        |
| `--skill-install [name]`|       | Install a community skill                       |
| `--project`             |       | Install skill to project level (with --skill-install) |
| `--permissions`         |       | Display current permission settings and exit    |
| `--login`               |       | Sign in to your Autohand account                |
| `--logout`              |       | Sign out of your Autohand account               |
| `--sync-settings [bool]`|       | Enable/disable settings sync (default: true for logged users) |
| `--patch`               |       | Generate git patch without applying changes     |
| `--output <file>`       |       | Output file for patch (default: stdout)         |
| `--mode <mode>`         |       | Run mode: interactive (default), rpc, or acp   |
| `--acp`                 |       | Shorthand for --mode acp (Agent Client Protocol over stdio) |
| `--teammate-mode <mode>`|       | Team display mode: auto, in-process, or tmux    |
| `--worktree [name]`     |       | Run session in isolated git worktree (optional name) |
| `--tmux`                |       | Launch in a dedicated tmux session (implies --worktree) |
| `--auto-mode [prompt]`  |       | Enable interactive auto-mode, or start standalone loop with inline task |
| `--max-iterations <n>`  |       | Max auto-mode iterations (default: 50)          |
| `--completion-promise <text>` | | Completion marker text (default: "DONE")     |
| `--no-worktree`         |       | Disable git worktree isolation in auto-mode    |
| `--checkpoint-interval <n>` |  | Git commit every N iterations (default: 5)      |
| `--max-runtime <m>`     |       | Max runtime in minutes (default: 120)          |
| `--max-cost <d>`        |       | Max API cost in dollars (default: 10)          |
| `--interactive-on-complete` | | After auto-mode ends, hand off to interactive mode (TTY only) |
| `--setup`               |       | Run the setup wizard to configure or reconfigure Autohand |
| `--about`               |       | Show information about Autohand                |
| `--add-dir <path...>`   |       | Add additional directories to workspace scope (can be used multiple times) |
| `--display-language <locale>` | | Set display language (e.g., en, zh-cn, fr, de, ja) |
| `--cc, --context-compact` |    | Enable context compaction (default: on)        |
| `--no-cc, --no-context-compact` | | Disable context compaction                   |
| `--search-engine <provider>` | | Set web search provider (google, brave, duckduckgo, parallel) |
| `--sys-prompt <value>`  |       | Replace entire system prompt (inline string or file path) |
| `--append-sys-prompt <value>` | | Append to system prompt (inline string or file path) |
| `--yolo [pattern]`      |       | Auto-approve tool calls matching pattern (e.g., allow:read,write or deny:delete) |
| `--timeout <seconds>`   |       | Timeout in seconds for auto-approve mode       |

## Agent Skills

Skills are modular instruction packages that extend Autohand with specialized workflows. They work like on-demand `AGENTS.md` files for specific tasks.

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
- Compatible with Codex and Claude skill formats

See [Agent Skills Documentation](docs/agent-skills.md) for creating custom skills.

## Slash Commands

| Command        | Description                          |
| -------------- | ------------------------------------ |
| `/help`        | Display available commands           |
| `/?`           | Alias for /help                      |
| `/quit`        | Exit the session                     |
| `/model`       | Switch LLM models                    |
| `/new`         | Start fresh conversation             |
| `/clear`       | Clear conversation history           |
| `/undo`        | Revert last changes                  |
| `/session`     | Show current session details         |
| `/sessions`    | List past sessions                   |
| `/resume`      | Resume a previous session            |
| `/memory`      | View/manage stored memories          |
| `/init`        | Create `AGENTS.md` file              |
| `/agents`      | List sub-agents                      |
| `/agents-new`  | Create new agent via wizard          |
| `/skills`      | List and manage skills               |
| `/skills new`  | Create a new skill                   |
| `/skills use`  | Activate a skill                     |
| `/skills install` | Install a community skill         |
| `/skills search` | Search for skills                  |
| `/skills trending` | List trending skills             |
| `/skills remove` | Remove an installed skill         |
| `/learn`       | Get skill recommendations            |
| `/feedback`    | Send feedback                        |
| `/formatters`  | List code formatters                 |
| `/lint`        | List code linters                    |
| `/completion`  | Generate shell completion scripts   |
| `/export`      | Export session to markdown/JSON/HTML |
| `/status`      | Show workspace status                |
| `/login`       | Authenticate with Autohand API       |
| `/logout`      | Sign out                             |
| `/permissions` | Manage tool permissions              |
| `/hooks`       | Manage git hooks                     |
| `/settings`    | View configuration settings          |
| `/theme`       | Change UI theme                      |
| `/language`    | Change display language              |
| `/cc`          | Toggle context compaction            |
| `/search`      | Search the web                       |
| `/automode`    | Manage auto-mode                     |
| `/sync`        | Sync settings across devices         |
| `/add-dir`     | Add additional workspace directory   |
| `/plan`        | Create a task plan                   |
| `/about`       | Show information about Autohand      |
| `/ide`         | Open in IDE                          |
| `/history`     | View command history                 |
| `/mcp`         | Manage MCP servers                   |
| `/mcp install` | Install community MCP servers        |
| `/team`        | Manage team collaboration            |
| `/tasks`       | List team tasks                      |
| `/message`     | Send team message                    |
| `/import`      | Import data from other agents        |
| `/repeat`      | Repeat previous actions             |
| `/chrome`      | Chrome browser integration           |
| `/review`      | Code review                          |

## Tool System

Autohand includes 40+ tools for autonomous coding:

### File Operations

`read_file`, `write_file`, `append_file`, `apply_patch`, `search`, `search_replace`, `semantic_search`, `list_tree`, `create_directory`, `delete_path`, `rename_path`, `copy_path`, `multi_file_edit`

### Git Operations

`git_status`, `git_diff`, `git_commit`, `git_add`, `git_branch`, `git_switch`, `git_merge`, `git_rebase`, `git_cherry_pick`, `git_stash`, `git_fetch`, `git_pull`, `git_push`, `auto_commit`

### Commands & Dependencies

`run_command`, `custom_command`, `add_dependency`, `remove_dependency`

### Planning & Memory

`plan`, `todo_write`, `save_memory`, `recall_memory`

### Meta Tools

`tools_registry` - List all available tools with descriptions.
`tool_search` - Search tools by capability, name, or description.

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

Create `~/.autohand/config.json`:

```json
{
  "provider": "openrouter",
  "openrouter": {
    "apiKey": "sk-or-...",
    "model": "anthropic/claude-sonnet-4-20250514"
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

| Provider   | Config Key   | Notes                               |
| ---------- | ------------ | ----------------------------------- |
| OpenRouter | `openrouter` | Access to Claude, GPT-4, Grok, etc. |
| Anthropic  | `anthropic`  | Direct Claude API access            |
| OpenAI     | `openai`     | GPT-4 and other models              |
| Ollama     | `ollama`     | Local models                        |
| llama.cpp  | `llamacpp`   | Local inference                     |
| MLX        | `mlx`        | Apple Silicon optimized             |

## Session Management

Sessions are auto-saved to `~/.autohand/sessions/`:

```bash
# Resume via command
autohand resume <session-id>

# Or in interactive mode
/resume
```

## Entire Integration

Autohand Code supports [Entire](https://entire.io) for session checkpointing. Entire captures your coding sessions -- prompts, file changes, and token usage -- as git-backed checkpoints that you can rewind to, review, and share.

```bash
# Install hooks in this repository
entire enable --agent autohand-code

# Check status
entire status

# Remove hooks
entire disable --agent autohand-code
```

Once enabled, Entire works automatically through Autohand's hooks system. No changes to your workflow are needed. See the [Entire Integration Guide](docs/entire-integration.md) for setup details and troubleshooting.

## Security & Permissions

Autohand includes a permission system for sensitive operations:

- **Interactive** (default): Prompts for confirmation on risky actions
- **Unrestricted** (`--unrestricted`): No approval prompts
- **Restricted** (`--restricted`): Denies all dangerous operations

Configure granular permissions in `~/.autohand/config.json`:

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

Telemetry is disabled by default. Opt-in to help improve Autohand:

```json
{
  "telemetry": {
    "enabled": true
  }
}
```

When enabled, Autohand collects anonymous usage data (no PII, no code content). See [Telemetry Documentation](docs/telemetry.md) for details.

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
bun test
```

## Docker

```dockerfile
FROM oven/bun:1
WORKDIR /app
COPY . .
RUN bun install && bun run build
CMD ["./dist/cli.js"]
```

```bash
docker build -t autohand .
docker run -it autohand
```

## Documentation

- [Playbook](AUTOHAND_PLAYBOOK.md) - 20 use cases for the software development lifecycle
- [Features](docs/features.md) - Complete feature list
- [Agent Skills](docs/agent-skills.md) - Skills system guide
- [Configuration Reference](docs/config-reference.md) - All config options
- [Entire Integration](docs/entire-integration.md) - Session checkpointing with Entire

## Contributing

We welcome contributions! Please read our [Contributing Guide](CONTRIBUTING.md) for details on how to get involved.

## Troubleshooting

### Common Issues

**Installation fails**: Make sure you have Bun installed and up to date.

**Permission denied**: Check your file permissions and try running with appropriate privileges.

**Model not working**: Verify your API key and model configuration in `~/.autohand/config.json`.

### Getting Help

- Join our [Discord community](https://discord.com/invite/MWTNudaj8E)
- Check the [documentation](docs/)
- Open an issue on [GitHub](https://github.com/autohandai/cli/issues)

## Community

- **Discord**: https://discord.com/invite/MWTNudaj8E
- **GitHub**: https://github.com/autohandai/cli
- **Website**: https://autohand.ai
- **Twitter**: [@autohandai](https://twitter.com/autohandai)

## Security

Autohand is designed with security in mind:

- **No Code Execution**: Autohand only suggests changes, you approve them
- **Permission System**: Fine-grained control over what operations are allowed
- **Local Processing**: Your code never leaves your machine unless you choose
- **Open Source**: Transparent code that can be audited

## License

Apache License 2.0 - Free for individuals, non-profits, educational institutions, open source projects, and companies with ARR under $5M. See [LICENSE](LICENSE) and [COMMERCIAL.md](COMMERCIAL.md) for details.

## Links

- Website: https://autohand.ai
- CLI Install: https://autohand.ai/cli/
- GitHub: https://github.com/autohandai/cli
- API Backend: https://github.com/autohandai/api
- Discord: https://discord.com/invite/MWTNudaj8E

## Roadmap

### Upcoming Features

- **Enhanced AI Models**: Support for newer models and improved reasoning
- **Plugin System**: Easier way to extend Autohand with custom functionality
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

**Ready to get started?** Run `autohand` in your terminal and experience the future of coding!