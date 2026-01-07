# Autohand Code CLI

[![Bun](https://img.shields.io/badge/Bun-%23c61f33?style=flat&logo=bun&logoColor=white)](https://bun.sh)

**An coding agentic CLI that reads, reasons, and writes code across your entire project. No context switching. No copy-paste, No you're absolute right!.**

Autohand Code CLI is an autonomous LLM-powered coding agent that lives in your terminal. It uses the ReAct (Reason + Act) pattern to understand your codebase, plan changes, and execute them with your approval. It's blazing fast, intuitive, and extensible with a modular skill system.

We built with a very minimalistic design philosophy to keep the focus on coding. Just install, run `autohand`, and start giving instructions in natural language. Autohand handles the rest.

Scale Autohand across your team and CI/CD pipelines to automate repetitive coding tasks, enforce code quality, and accelerate development velocity.

![Alt Autohand in the terminal](docs/gif/autohand-intro.gif)

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

## Usage Modes

### Interactive Mode

Launch without arguments for a full REPL experience:

```bash
autohand
```

Features:

- Type `/` for slash command suggestions
- Type `@` for file autocomplete (e.g., `@src/index.ts`)
- Press `ESC` to cancel in-flight requests
- Press `Ctrl+C` twice to exit

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
| `--model <model>`       |       | Override the configured LLM model               |
| `--path <path>`         |       | Workspace path to operate in                    |
| `--auto-skill`          |       | Auto-generate skills based on project analysis  |
| `--unrestricted`        |       | Run without approval prompts (use with caution) |
| `--restricted`          |       | Deny all dangerous operations automatically     |
| `--config <path>`       |       | Path to config file                             |
| `--temperature <value>` |       | Sampling temperature for LLM                    |

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
| `/quit`        | Exit the session                     |
| `/model`       | Switch LLM models                    |
| `/new`         | Start fresh conversation             |
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
| `/feedback`    | Send feedback                        |
| `/formatters`  | List code formatters                 |
| `/lint`        | List code linters                    |
| `/completion`  | Generate shell completion scripts    |
| `/export`      | Export session to markdown/JSON/HTML |
| `/status`      | Show workspace status                |
| `/login`       | Authenticate with Autohand API       |
| `/logout`      | Sign out                             |
| `/permissions` | Manage tool permissions              |

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

## License

Apache License 2.0 - Free for individuals, non-profits, educational institutions, open source projects, and companies with ARR under $5M. See [LICENSE](LICENSE) and [COMMERCIAL.md](COMMERCIAL.md) for details.

## Links

- Website: https://autohand.ai
- CLI Install: https://autohand.ai/cli/
- GitHub: https://github.com/autohandai/cli
- API Backend: https://github.com/autohandai/api
