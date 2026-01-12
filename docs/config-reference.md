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
- [Authentication Settings](#authentication-settings)
- [Community Skills Settings](#community-skills-settings)
- [Hooks Settings](#hooks-settings)
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
| `AUTOHAND_PERMISSION_CALLBACK_URL` | URL for permission callback (experimental) | `http://localhost:3000/callback` |
| `AUTOHAND_PERMISSION_CALLBACK_TIMEOUT` | Timeout for permission callback in ms | `5000` |
| `AUTOHAND_NON_INTERACTIVE` | Run in non-interactive mode | `1` |
| `AUTOHAND_YES` | Auto-confirm all prompts | `1` |
| `AUTOHAND_NO_BANNER` | Disable startup banner | `1` |
| `AUTOHAND_STREAM_TOOL_OUTPUT` | Stream tool output in real-time | `1` |
| `AUTOHAND_DEBUG` | Enable debug logging | `1` |
| `AUTOHAND_THINKING_LEVEL` | Set reasoning depth level | `normal` |
| `AUTOHAND_CLIENT_NAME` | Client/editor identifier (set by ACP extensions) | `zed` |
| `AUTOHAND_CLIENT_VERSION` | Client version (set by ACP extensions) | `0.169.0` |

### Thinking Level

The `AUTOHAND_THINKING_LEVEL` environment variable controls the depth of reasoning the model uses:

| Value | Description |
|-------|-------------|
| `none` | Direct responses without visible reasoning |
| `normal` | Standard reasoning depth (default) |
| `extended` | Deep reasoning for complex tasks, shows more detailed thought process |

This is typically set by ACP client extensions (like Zed) through the config dropdown.

```bash
# Example: Use extended thinking for complex tasks
AUTOHAND_THINKING_LEVEL=extended autohand --prompt "refactor this module"
```

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

### Workspace Safety

Autohand automatically blocks operation in dangerous directories to prevent accidental damage:

- **Filesystem roots** (`/`, `C:\`, `D:\`, etc.)
- **Home directories** (`~`, `/Users/<user>`, `/home/<user>`, `C:\Users\<user>`)
- **System directories** (`/etc`, `/var`, `/System`, `C:\Windows`, etc.)
- **WSL Windows mounts** (`/mnt/c`, `/mnt/c/Users/<user>`)

This check cannot be bypassed. If you try to run autohand in a dangerous directory, you'll see an error and must specify a safe project directory.

```bash
# This will be blocked
cd ~ && autohand
# Error: Unsafe Workspace Directory

# This works
cd ~/projects/my-app && autohand
```

See [Workspace Safety](./workspace-safety.md) for full details.

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
    "useInkRenderer": false,
    "terminalBell": true,
    "checkForUpdates": true,
    "updateCheckInterval": 24
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `theme` | `"dark"` | `"light"` | `"dark"` | Color theme for terminal output |
| `autoConfirm` | boolean | `false` | Skip confirmation prompts for safe operations |
| `readFileCharLimit` | number | `300` | Max characters to display from read/search tool output (full content is still sent to the model) |
| `showCompletionNotification` | boolean | `true` | Show system notification when task completes |
| `showThinking` | boolean | `true` | Display LLM's reasoning/thought process |
| `useInkRenderer` | boolean | `false` | Use Ink-based renderer for flicker-free UI (experimental) |
| `terminalBell` | boolean | `true` | Ring terminal bell when task completes (shows badge on terminal tab/dock) |
| `checkForUpdates` | boolean | `true` | Check for CLI updates on startup |
| `updateCheckInterval` | number | `24` | Hours between update checks (uses cached result within interval) |

Note: `readFileCharLimit` only affects terminal display for `read_file`, `search`, and `search_with_context`. Full content is still sent to the model and stored in tool messages.

### Terminal Bell

When `terminalBell` is enabled (default), Autohand rings the terminal bell (`\x07`) when a task completes. This triggers:

- **Badge on terminal tab** - Shows a visual indicator that work is done
- **Dock icon bounce** - Gets your attention when terminal is in background (macOS)
- **Sound** - If terminal sounds are enabled in your terminal settings

Terminal-specific settings:
- **macOS Terminal**: Preferences > Profiles > Advanced > Bell (Visual/Audible)
- **iTerm2**: Preferences > Profiles > Terminal > Notifications
- **VS Code Terminal**: Settings > Terminal > Integrated: Enable Bell

To disable:
```json
{
  "ui": {
    "terminalBell": false
  }
}
```

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

### Update Check

When `checkForUpdates` is enabled (default), Autohand checks for new releases on startup:

```
> Autohand v0.6.8 (abc1234) ✓ Up to date
```

If an update is available:
```
> Autohand v0.6.7 (abc1234) ⬆ Update available: v0.6.8
  ↳ Run: curl -fsSL https://autohand.ai/install.sh | sh
```

How it works:
- Fetches latest release from GitHub API
- Caches result in `~/.autohand/version-check.json`
- Only checks once per `updateCheckInterval` hours (default: 24)
- Non-blocking: startup continues even if check fails

To disable:
```json
{
  "ui": {
    "checkForUpdates": false
  }
}
```

Or via environment variable:
```bash
export AUTOHAND_SKIP_UPDATE_CHECK=1
```

---

## Agent Settings

Control agent behavior and iteration limits.

```json
{
  "agent": {
    "maxIterations": 100,
    "enableRequestQueue": true,
    "debug": false
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxIterations` | number | `100` | Maximum tool iterations per user request before stopping |
| `enableRequestQueue` | boolean | `true` | Allow users to type and queue requests while agent is working |
| `debug` | boolean | `false` | Enable verbose debug output (logs agent internal state to stderr) |

### Debug Mode

Enable debug mode to see verbose logging of agent internal state (react loop iterations, prompt building, session details). Output goes to stderr to avoid interfering with normal output.

Three ways to enable debug mode (in order of precedence):

1. **CLI flag**: `autohand -d` or `autohand --debug`
2. **Environment variable**: `AUTOHAND_DEBUG=1`
3. **Config file**: Set `agent.debug: true`

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
| `action` | `"allow"` | `"deny"` | `"prompt"` | Action to take |

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

### Viewing Permissions

You can view your current permission settings in two ways:

**CLI Flag (Non-interactive):**
```bash
autohand --permissions
```

This displays:
- Current permission mode (interactive, unrestricted, restricted)
- Workspace and config file paths
- All approved patterns (whitelist)
- All denied patterns (blacklist)
- Summary statistics

**Interactive Command:**
```
/permissions
```

In interactive mode, the `/permissions` command provides the same information plus options to:
- Remove items from the whitelist
- Remove items from the blacklist
- Clear all saved permissions

---

## Patch Mode

Patch mode allows you to generate a shareable git-compatible patch without modifying your workspace files. This is useful for:
- Code review before applying changes
- Sharing AI-generated changes with team members
- Creating reproducible change sets
- CI/CD pipelines that need to capture changes without applying them

### Usage

```bash
# Generate patch to stdout
autohand --prompt "add user authentication" --patch

# Save to file
autohand --prompt "add user authentication" --patch --output auth.patch

# Pipe to file (alternative)
autohand --prompt "refactor api handlers" --patch > refactor.patch
```

### Behavior

When `--patch` is specified:
- **Auto-confirm**: All confirmations are automatically accepted (`--yes` implied)
- **No prompts**: No approval prompts are shown (`--unrestricted` implied)
- **Preview only**: Changes are captured but NOT written to disk
- **Security enforced**: Blacklisted operations (`.env`, SSH keys, dangerous commands) are still blocked

### Applying Patches

Recipients can apply the patch using standard git commands:

```bash
# Check what would be applied (dry-run)
git apply --check changes.patch

# Apply the patch
git apply changes.patch

# Apply with 3-way merge (handles conflicts better)
git apply -3 changes.patch

# Apply and stage changes
git apply --index changes.patch

# Reverse a patch
git apply -R changes.patch
```

### Patch Format

The generated patch follows git's unified diff format:

```diff
diff --git a/src/auth.ts b/src/auth.ts
new file mode 100644
--- /dev/null
+++ b/src/auth.ts
@@ -0,0 +1,15 @@
+export function authenticate(user: string, password: string) {
+  // Implementation here
+}

diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,5 +1,7 @@
 import express from 'express';
+import { authenticate } from './auth';

 const app = express();
+app.use(authenticate);
```

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success, patch generated |
| `1` | Error (missing `--prompt`, permission denied, etc.) |

### Combining with Other Flags

```bash
# Use specific model
autohand --prompt "optimize queries" --patch --model gpt-4o

# Specify workspace
autohand --prompt "add tests" --patch --path ./my-project

# Use custom config
autohand --prompt "refactor" --patch --config ~/.autohand/work.json
```

### Team Workflow Example

```bash
# Developer A: Generate patch for a feature
autohand --prompt "implement user dashboard with charts" --patch --output dashboard.patch

# Share via git (create PR with just the patch file)
git checkout -b patch/dashboard
git add dashboard.patch
git commit -m "Add dashboard feature patch"
git push

# Developer B: Review and apply
git fetch origin patch/dashboard
git apply dashboard.patch
# Run tests, review code, then commit
git add -A && git commit -m "feat: add user dashboard with charts"
```

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

Telemetry is **disabled by default** (opt-in). Enable it to help improve Autohand.

```json
{
  "telemetry": {
    "enabled": false,
    "apiBaseUrl": "https://api.autohand.ai",
    "batchSize": 20,
    "flushIntervalMs": 60000,
    "maxQueueSize": 500,
    "maxRetries": 3,
    "enableSessionSync": false,
    "companySecret": ""
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable/disable telemetry (opt-in) |
| `apiBaseUrl` | string | `https://api.autohand.ai` | Telemetry API endpoint |
| `batchSize` | number | `20` | Number of events to batch before auto-flush |
| `flushIntervalMs` | number | `60000` | Flush interval in milliseconds (1 minute) |
| `maxQueueSize` | number | `500` | Maximum queue size before dropping old events |
| `maxRetries` | number | `3` | Retry attempts for failed telemetry requests |
| `enableSessionSync` | boolean | `false` | Sync sessions to cloud for team features |
| `companySecret` | string | `""` | Company secret for API authentication |
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

## Authentication Settings

Authentication and user session configuration.

```json
{
  "auth": {
    "token": "your-auth-token",
    "user": {
      "id": "user-id",
      "email": "user@example.com",
      "name": "User Name",
      "avatar": "https://example.com/avatar.png"
    },
    "expiresAt": "2025-12-31T23:59:59Z"
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `token` | string | - | Authentication token for API access |
| `user` | object | - | Authenticated user information |
| `user.id` | string | - | User ID |
| `user.email` | string | - | User email address |
| `user.name` | string | - | User display name |
| `user.avatar` | string | - | User avatar URL (optional) |
| `expiresAt` | string | - | Token expiration timestamp (ISO 8601 format) |

---

## Community Skills Settings

Configuration for community skills discovery and management.

```json
{
  "communitySkills": {
    "enabled": true,
    "showSuggestionsOnStartup": true,
    "autoBackup": true
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable community skills features |
| `showSuggestionsOnStartup` | boolean | `true` | Show skill suggestions on startup when no vendor skills exist |
| `autoBackup` | boolean | `true` | Automatically backup discovered vendor skills to API |

---

## Hooks Settings

Configuration for lifecycle hooks that run shell commands on agent events. See [Hooks Documentation](./hooks.md) for full details.

```json
{
  "hooks": {
    "enabled": true,
    "hooks": [
      {
        "event": "pre-tool",
        "command": "echo \"Running tool: $HOOK_TOOL\" >> ~/.autohand/hooks.log",
        "description": "Log all tool executions",
        "enabled": true
      },
      {
        "event": "file-modified",
        "command": "./scripts/on-file-change.sh",
        "description": "Custom file change handler",
        "filter": { "path": ["src/**/*.ts"] }
      },
      {
        "event": "post-response",
        "command": "curl -X POST https://api.example.com/webhook -d '{\"tokens\": $HOOK_TOKENS}'",
        "description": "Track token usage",
        "async": true
      }
    ]
  }
}
```

### `hooks`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable all hooks globally |
| `hooks` | array | `[]` | Array of hook definitions |

### Hook Definition

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `event` | string | Yes | - | Event to hook into |
| `command` | string | Yes | - | Shell command to execute |
| `description` | string | No | - | Description for `/hooks` display |
| `enabled` | boolean | No | `true` | Whether hook is active |
| `timeout` | number | No | `5000` | Timeout in milliseconds |
| `async` | boolean | No | `false` | Run without blocking |
| `filter` | object | No | - | Filter by tool or path |

### Hook Events

| Event | When Fired |
|-------|------------|
| `pre-tool` | Before any tool executes |
| `post-tool` | After tool completes |
| `file-modified` | When file is created/modified/deleted |
| `pre-prompt` | Before sending to LLM |
| `post-response` | After LLM responds |
| `session-error` | When error occurs |

### Environment Variables

When hooks execute, these environment variables are available:

| Variable | Description |
|----------|-------------|
| `HOOK_EVENT` | Event name |
| `HOOK_WORKSPACE` | Workspace root path |
| `HOOK_TOOL` | Tool name (tool events) |
| `HOOK_ARGS` | JSON-encoded tool args |
| `HOOK_SUCCESS` | true/false (post-tool) |
| `HOOK_PATH` | File path (file-modified) |
| `HOOK_TOKENS` | Tokens used (post-response) |

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
    "showThinking": true,
    "terminalBell": true,
    "checkForUpdates": true,
    "updateCheckInterval": 24
  },
  "agent": {
    "maxIterations": 100,
    "enableRequestQueue": true,
    "debug": false
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
    "enabled": false,
    "apiBaseUrl": "https://api.autohand.ai",
    "batchSize": 20,
    "flushIntervalMs": 60000,
    "maxQueueSize": 500,
    "maxRetries": 3,
    "enableSessionSync": false
  },
  "externalAgents": {
    "enabled": false,
    "paths": []
  },
  "api": {
    "baseUrl": "https://api.autohand.ai"
  },
  "auth": {
    "token": "your-auth-token",
    "user": {
      "id": "user-id",
      "email": "user@example.com",
      "name": "User Name"
    }
  },
  "communitySkills": {
    "enabled": true,
    "showSuggestionsOnStartup": true,
    "autoBackup": true
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
  terminalBell: true
  checkForUpdates: true
  updateCheckInterval: 24

agent:
  maxIterations: 100
  enableRequestQueue: true
  debug: false

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
  enabled: false
  apiBaseUrl: https://api.autohand.ai
  batchSize: 20
  flushIntervalMs: 60000
  maxQueueSize: 500
  maxRetries: 3
  enableSessionSync: false

externalAgents:
  enabled: false
  paths: []

api:
  baseUrl: https://api.autohand.ai

auth:
  token: your-auth-token
  user:
    id: user-id
    email: user@example.com
    name: User Name

communitySkills:
  enabled: true
  showSuggestionsOnStartup: true
  autoBackup: true
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
| `-d, --debug` | Enable verbose debug output |
| `--unrestricted` | No approval prompts |
| `--restricted` | Deny dangerous operations |
| `--permissions` | Display current permission settings and exit |
| `--patch` | Generate git patch without applying changes |
| `--output <file>` | Output file for patch (used with --patch) |
| `--auto-skill` | Auto-generate skills based on project analysis |
| `-c, --auto-commit` | Auto-commit changes after completing tasks |
| `--login` | Sign in to your Autohand account |
| `--logout` | Sign out of your Autohand account |