# Autohand Configuration Reference

Complete reference for all configuration options in `~/.autohand/config.json` (or `.yaml`/`.yml`).

## Table of Contents

- [Configuration File Location](#configuration-file-location)
- [Environment Variables](#environment-variables)
- [Provider Settings](#provider-settings)
- [Workspace Settings](#workspace-settings)
- [UI Settings](#ui-settings)
- [Agent Settings](#agent-settings)
- [Permissions Settings](#permissions-settings)
- [Network Settings](#network-settings)
- [Telemetry Settings](#telemetry-settings)
- [External Agents](#external-agents)
- [Skills System](#skills-system)
- [API Settings](#api-settings)
- [Complete Example](#complete-example)

---

## Configuration File Location

Autohand looks for configuration in this order:

1. `AUTOHAND_CONFIG` environment variable (custom path)
2. `~/.autohand/config.yaml`
3. `~/.autohand/config.yml`
4. `~/.autohand/config.json` (default)

You can also override the base directory:
```bash
export AUTOHAND_HOME=/custom/path  # Changes ~/.autohand to /custom/path
```

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `AUTOHAND_HOME` | Base directory for all Autohand data | `/custom/path` |
| `AUTOHAND_CONFIG` | Custom config file path | `/path/to/config.json` |
| `AUTOHAND_API_URL` | API endpoint (overrides config) | `https://api.autohand.ai` |
| `AUTOHAND_SECRET` | Company/team secret key | `sk-xxx` |

---

## Provider Settings

### `provider`
Active LLM provider to use.

| Value | Description |
|-------|-------------|
| `"openrouter"` | OpenRouter API (default) |
| `"ollama"` | Local Ollama instance |
| `"llamacpp"` | Local llama.cpp server |
| `"openai"` | OpenAI API directly |

### `openrouter`
OpenRouter provider configuration.

```json
{
  "openrouter": {
    "apiKey": "sk-or-v1-xxx",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "anthropic/claude-sonnet-4"
  }
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `apiKey` | string | Yes | - | Your OpenRouter API key |
| `baseUrl` | string | No | `https://openrouter.ai/api/v1` | API endpoint |
| `model` | string | Yes | - | Model identifier (e.g., `anthropic/claude-sonnet-4`) |

### `ollama`
Ollama provider configuration.

```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "port": 11434,
    "model": "llama3.2"
  }
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `baseUrl` | string | No | `http://localhost:11434` | Ollama server URL |
| `port` | number | No | `11434` | Server port (alternative to baseUrl) |
| `model` | string | Yes | - | Model name (e.g., `llama3.2`, `codellama`) |

### `llamacpp`
llama.cpp server configuration.

```json
{
  "llamacpp": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "default"
  }
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `baseUrl` | string | No | `http://localhost:8080` | llama.cpp server URL |
| `port` | number | No | `8080` | Server port |
| `model` | string | Yes | - | Model identifier |

### `openai`
OpenAI API configuration.

```json
{
  "openai": {
    "apiKey": "sk-xxx",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o"
  }
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `apiKey` | string | Yes | - | OpenAI API key |
| `baseUrl` | string | No | `https://api.openai.com/v1` | API endpoint |
| `model` | string | Yes | - | Model name (e.g., `gpt-4o`, `gpt-4o-mini`) |

---

## Workspace Settings

```json
{
  "workspace": {
    "defaultRoot": "/path/to/projects",
    "allowDangerousOps": false
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `defaultRoot` | string | Current directory | Default workspace when none specified |
| `allowDangerousOps` | boolean | `false` | Allow destructive operations without confirmation |

---

## UI Settings

```json
{
  "ui": {
    "theme": "dark",
    "autoConfirm": false,
    "readFileCharLimit": 300,
    "showCompletionNotification": true,
    "showThinking": true,
    "useInkRenderer": false
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `theme` | `"dark"` \| `"light"` | `"dark"` | Color theme for terminal output |
| `autoConfirm` | boolean | `false` | Skip confirmation prompts for safe operations |
| `readFileCharLimit` | number | `300` | Max characters to display from read/search tool output (full content is still sent to the model) |
| `showCompletionNotification` | boolean | `true` | Show system notification when task completes |
| `showThinking` | boolean | `true` | Display LLM's reasoning/thought process |
| `useInkRenderer` | boolean | `false` | Use Ink-based renderer for flicker-free UI (experimental) |

Note: `readFileCharLimit` only affects terminal display for `read_file`, `search`, and `search_with_context`. Full content is still sent to the model and stored in tool messages.

### Ink Renderer (Experimental)

When `useInkRenderer` is enabled, Autohand uses React-based terminal rendering (Ink) instead of the traditional ora spinner. This provides:

- **Flicker-free output**: All UI updates are batched through React reconciliation
- **Working queue feature**: Type instructions while the agent works
- **Better input handling**: No conflicts between readline handlers
- **Composable UI**: Foundation for future advanced UI features

To enable:
```json
{
  "ui": {
    "useInkRenderer": true
  }
}
```

Note: This feature is experimental and may have edge cases. The default ora-based UI remains stable and fully functional.

---

## Agent Settings

Control agent behavior and iteration limits.

```json
{
  "agent": {
    "maxIterations": 100,
    "enableRequestQueue": true
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxIterations` | number | `100` | Maximum tool iterations per user request before stopping |
| `enableRequestQueue` | boolean | `true` | Allow users to type and queue requests while agent is working |

### Request Queue

When `enableRequestQueue` is enabled, you can continue typing messages while the agent processes a previous request. Your input will be queued and processed automatically when the current task completes.

- Type your message and press Enter to add it to the queue
- The status line shows how many requests are queued
- Requests are processed in FIFO (first-in, first-out) order
- Maximum queue size is 10 requests

---

## Permissions Settings

Fine-grained control over tool permissions.

```json
{
  "permissions": {
    "mode": "interactive",
    "whitelist": [
      "run_command:npm *",
      "run_command:bun *",
      "run_command:git status"
    ],
    "blacklist": [
      "run_command:rm -rf *",
      "run_command:sudo *"
    ],
    "rules": [
      {
        "tool": "run_command",
        "pattern": "npm test",
        "action": "allow"
      }
    ],
    "rememberSession": true
  }
}
```

### `mode`

| Value | Description |
|-------|-------------|
| `"interactive"` | Prompt for approval on dangerous operations (default) |
| `"unrestricted"` | No prompts, allow everything |
| `"restricted"` | Deny all dangerous operations |

### `whitelist`
Array of tool patterns that never require approval.

```json
["run_command:npm *", "run_command:bun test"]
```

### `blacklist`
Array of tool patterns that are always blocked.

```json
["run_command:rm -rf /", "run_command:sudo *"]
```

### `rules`
Fine-grained permission rules.

| Field | Type | Description |
|-------|------|-------------|
| `tool` | string | Tool name to match |
| `pattern` | string | Optional pattern to match against arguments |
| `action` | `"allow"` \| `"deny"` \| `"prompt"` | Action to take |

### `rememberSession`
| Type | Default | Description |
|------|---------|-------------|
| boolean | `true` | Remember approval decisions for the session |

### Local Project Permissions

Each project can have its own permission settings that override the global config. These are stored in `.autohand/settings.local.json` in your project root.

When you approve a file operation (edit, write, delete), it's automatically saved to this file so you won't be asked again for the same operation in this project.

```json
{
  "version": 1,
  "permissions": {
    "whitelist": [
      "multi_file_edit:src/components/Button.tsx",
      "write_file:package.json",
      "run_command:bun test"
    ]
  }
}
```

**How it works:**
- When you approve an operation, it's saved to `.autohand/settings.local.json`
- Next time, the same operation will be auto-approved
- Local project settings are merged with global settings (local takes priority)
- Add `.autohand/settings.local.json` to `.gitignore` to keep personal settings private

**Pattern format:**
- `tool_name:path` - For file operations (e.g., `multi_file_edit:src/file.ts`)
- `tool_name:command args` - For commands (e.g., `run_command:npm test`)

---

## Network Settings

```json
{
  "network": {
    "maxRetries": 3,
    "timeout": 30000,
    "retryDelay": 1000
  }
}
```

| Field | Type | Default | Max | Description |
|-------|------|---------|-----|-------------|
| `maxRetries` | number | `3` | `5` | Retry attempts for failed API requests |
| `timeout` | number | `30000` | - | Request timeout in milliseconds |
| `retryDelay` | number | `1000` | - | Delay between retries in milliseconds |

---

## Telemetry Settings

```json
{
  "telemetry": {
    "enabled": true,
    "apiBaseUrl": "https://api.autohand.ai",
    "enableSessionSync": true
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable telemetry |
| `apiBaseUrl` | string | `https://api.autohand.ai` | Telemetry API endpoint |
| `enableSessionSync` | boolean | `true` | Sync sessions to cloud for team features |

---

## External Agents

Load custom agent definitions from external directories.

```json
{
  "externalAgents": {
    "enabled": true,
    "paths": [
      "~/.autohand/agents",
      "/team/shared/agents"
    ]
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable external agent loading |
| `paths` | string[] | `[]` | Directories to load agents from |

---

## Skills System

Skills are instruction packages that provide specialized instructions to the AI agent. They work like on-demand `AGENTS.md` files that can be activated for specific tasks.

### Skill Discovery Locations

Skills are discovered from multiple locations, with later sources taking precedence:

| Location | Source ID | Description |
|----------|-----------|-------------|
| `~/.codex/skills/**/SKILL.md` | `codex-user` | User-level Codex skills (recursive) |
| `~/.claude/skills/*/SKILL.md` | `claude-user` | User-level Claude skills (one level) |
| `~/.autohand/skills/**/SKILL.md` | `autohand-user` | User-level Autohand skills (recursive) |
| `<project>/.claude/skills/*/SKILL.md` | `claude-project` | Project-level Claude skills (one level) |
| `<project>/.autohand/skills/**/SKILL.md` | `autohand-project` | Project-level Autohand skills (recursive) |

### Auto-Copy Behavior

Skills discovered from Codex or Claude locations are automatically copied to the corresponding Autohand location:

- `~/.codex/skills/` and `~/.claude/skills/` → `~/.autohand/skills/`
- `<project>/.claude/skills/` → `<project>/.autohand/skills/`

Existing skills in Autohand locations are never overwritten.

### SKILL.md Format

Skills use YAML frontmatter followed by markdown content:

```markdown
---
name: my-skill-name
description: Brief description of the skill
license: MIT
compatibility: Works with Node.js 18+
allowed-tools: read_file write_file run_command
metadata:
  author: your-name
  version: "1.0.0"
---

# My Skill

Detailed instructions for the AI agent...
```

| Field | Required | Max Length | Description |
|-------|----------|------------|-------------|
| `name` | Yes | 64 chars | Lowercase alphanumeric with hyphens only |
| `description` | Yes | 1024 chars | Brief description of the skill |
| `license` | No | - | License identifier (e.g., MIT, Apache-2.0) |
| `compatibility` | No | 500 chars | Compatibility notes |
| `allowed-tools` | No | - | Space-delimited list of allowed tools |
| `metadata` | No | - | Additional key-value metadata |

### Slash Commands

| Command | Description |
|---------|-------------|
| `/skills` | List all available skills |
| `/skills use <name>` | Activate a skill for the current session |
| `/skills deactivate <name>` | Deactivate a skill |
| `/skills info <name>` | Show detailed skill information |
| `/skills new` | Create a new skill interactively |

### Auto-Skill Generation

The `--auto-skill` flag analyzes your project and generates relevant skills:

```bash
autohand --auto-skill
```

This will:
1. Analyze your project structure (package.json, requirements.txt, etc.)
2. Detect languages, frameworks, and patterns
3. Generate 3-5 relevant skills using LLM
4. Save skills to `<project>/.autohand/skills/`

Detected patterns include:
- **Languages**: TypeScript, JavaScript, Python, Rust, Go
- **Frameworks**: React, Next.js, Vue, Express, Flask, Django
- **Patterns**: CLI tools, testing, monorepo, Docker, CI/CD

---

## API Settings

Backend API configuration for team features.

```json
{
  "api": {
    "baseUrl": "https://api.autohand.ai",
    "companySecret": "sk-team-xxx"
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `baseUrl` | string | `https://api.autohand.ai` | API endpoint |
| `companySecret` | string | - | Team/company secret for shared features |

Can also be set via environment variables:
- `AUTOHAND_API_URL` → `api.baseUrl`
- `AUTOHAND_SECRET` → `api.companySecret`

---

## Complete Example

### JSON Format (`~/.autohand/config.json`)

```json
{
  "provider": "openrouter",
  "openrouter": {
    "apiKey": "sk-or-v1-your-key-here",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "anthropic/claude-sonnet-4"
  },
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "model": "llama3.2"
  },
  "workspace": {
    "defaultRoot": "~/projects",
    "allowDangerousOps": false
  },
  "ui": {
    "theme": "dark",
    "autoConfirm": false,
    "showCompletionNotification": true,
    "showThinking": true
  },
  "agent": {
    "maxIterations": 100,
    "enableRequestQueue": true
  },
  "permissions": {
    "mode": "interactive",
    "whitelist": [
      "run_command:npm *",
      "run_command:bun *"
    ],
    "blacklist": [
      "run_command:rm -rf /"
    ],
    "rememberSession": true
  },
  "network": {
    "maxRetries": 3,
    "timeout": 30000,
    "retryDelay": 1000
  },
  "telemetry": {
    "enabled": true,
    "enableSessionSync": true
  },
  "externalAgents": {
    "enabled": false,
    "paths": []
  },
  "api": {
    "baseUrl": "https://api.autohand.ai"
  }
}
```

### YAML Format (`~/.autohand/config.yaml`)

```yaml
provider: openrouter

openrouter:
  apiKey: sk-or-v1-your-key-here
  baseUrl: https://openrouter.ai/api/v1
  model: anthropic/claude-sonnet-4

ollama:
  baseUrl: http://localhost:11434
  model: llama3.2

workspace:
  defaultRoot: ~/projects
  allowDangerousOps: false

ui:
  theme: dark
  autoConfirm: false
  showCompletionNotification: true
  showThinking: true

agent:
  maxIterations: 100
  enableRequestQueue: true

permissions:
  mode: interactive
  whitelist:
    - "run_command:npm *"
    - "run_command:bun *"
  blacklist:
    - "run_command:rm -rf /"
  rememberSession: true

network:
  maxRetries: 3
  timeout: 30000
  retryDelay: 1000

telemetry:
  enabled: true
  enableSessionSync: true

externalAgents:
  enabled: false
  paths: []

api:
  baseUrl: https://api.autohand.ai
```

---

## Directory Structure

Autohand stores data in `~/.autohand/` (or `$AUTOHAND_HOME`):

```
~/.autohand/
├── config.json          # Main configuration
├── config.yaml          # Alternative YAML config
├── device-id            # Unique device identifier
├── error.log            # Error log
├── feedback.log         # Feedback submissions
├── sessions/            # Session history
├── projects/            # Project knowledge base
├── memory/              # User-level memory
├── commands/            # Custom commands
├── agents/              # Agent definitions
├── tools/               # Custom meta-tools
├── feedback/            # Feedback state
└── telemetry/           # Telemetry data
    ├── queue.json
    └── session-sync-queue.json
```

**Project-level directory** (in your workspace root):

```
<project>/.autohand/
├── settings.local.json  # Local project permissions (gitignore this)
├── memory/              # Project-specific memory
└── skills/              # Project-specific skills
```

---

## CLI Flags (Override Config)

These flags override config file settings:

| Flag | Description |
|------|-------------|
| `--model <model>` | Override model |
| `--path <path>` | Override workspace root |
| `--config <path>` | Use custom config file |
| `--temperature <n>` | Set temperature (0-1) |
| `--yes` | Auto-confirm prompts |
| `--dry-run` | Preview without executing |
| `--unrestricted` | No approval prompts |
| `--restricted` | Deny dangerous operations |
| `--auto-skill` | Auto-generate skills based on project analysis |
| `-c, --auto-commit` | Auto-commit changes after completing tasks |
