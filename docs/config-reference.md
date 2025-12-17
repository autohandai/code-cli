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
    "readFileCharLimit": 50000,
    "showCompletionNotification": true,
    "showThinking": true
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `theme` | `"dark"` \| `"light"` | `"dark"` | Color theme for terminal output |
| `autoConfirm` | boolean | `false` | Skip confirmation prompts for safe operations |
| `readFileCharLimit` | number | `50000` | Max characters to read from a single file |
| `showCompletionNotification` | boolean | `true` | Show system notification when task completes |
| `showThinking` | boolean | `true` | Display LLM's reasoning/thought process |

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
