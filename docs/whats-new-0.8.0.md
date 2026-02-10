# What's New in Autohand 0.8.0

Autohand 0.8.0 is a major release that brings pipe mode for composable Unix workflows, extended thinking controls, granular auto-approve (yolo mode), MCP client support, IDE integration, plan mode, and much more. This document covers every new feature and improvement shipped in this release.

## Table of Contents

- [Pipe Mode](#pipe-mode)
- [Extended Thinking](#extended-thinking)
- [Session History](#session-history)
- [Granular Auto-Approve (Yolo Mode)](#granular-auto-approve-yolo-mode)
- [MCP Client Support](#mcp-client-support)
- [IDE Integration](#ide-integration)
- [Homebrew Installation](#homebrew-installation)
- [Plan Mode](#plan-mode)
- [Web Repo Tool](#web-repo-tool)
- [Auto Compact Context](#auto-compact-context)
- [Custom System Prompt](#custom-system-prompt)
- [New CLI Flags](#new-cli-flags)
- [New Slash Commands](#new-slash-commands)
- [Architecture Improvements](#architecture-improvements)
- [Upgrading](#upgrading)

---

## Pipe Mode

Autohand now works seamlessly as part of Unix pipelines. When stdin is not a TTY, Autohand enters **pipe mode** -- a non-interactive execution path designed for composable workflows.

### How It Works

Pipe mode sends piped content together with your instruction to the LLM. The final result is written to stdout, while errors and progress go to stderr. This keeps the output stream clean for downstream consumers.

```bash
# Explain a diff
git diff | autohand 'explain these changes'

# Review code from a file
cat src/auth.ts | autohand 'review this code for security issues'

# Chain multiple tools
git log --oneline -10 | autohand 'summarize recent changes' > changelog.txt
```

### Output Routing

| Stream | Content |
|--------|---------|
| **stdout** | Final result only (consumed by downstream pipes) |
| **stderr** | Errors and optional progress messages |

### JSON Output

Use `--json` for structured ndjson output, ideal for programmatic consumption:

```bash
git diff | autohand 'review' --json
```

Each line is a valid JSON object:

```json
{"type": "result", "content": "The diff shows..."}
{"type": "error", "message": "Rate limit exceeded"}
```

### Verbose Progress

Use `--verbose` to send progress messages to stderr while keeping stdout clean:

```bash
git diff | autohand 'review' --verbose 2>progress.log
```

### Composable Examples

```bash
# Pipe chain: generate tests, then lint
autohand --prompt 'generate tests for auth.ts' | eslint --stdin

# Use with xargs
find src -name '*.ts' | xargs -I{} sh -c 'cat {} | autohand "review" > {}.review'

# CI integration
git diff HEAD~1 | autohand 'check for breaking changes' --json | jq '.content'
```

---

## Extended Thinking

Control how deeply the LLM reasons before responding with the `--thinking` flag. This is useful for tuning the balance between speed and thoroughness.

### Usage

```bash
# Extended reasoning for complex tasks
autohand --thinking extended

# Standard reasoning (default)
autohand --thinking normal

# Direct responses without visible reasoning
autohand --thinking none

# Shorthand: --thinking without a value defaults to extended
autohand --thinking
```

### Thinking Levels

| Level | Description | Best For |
|-------|-------------|----------|
| `extended` | Deep reasoning with detailed thought process | Complex refactoring, architecture decisions, debugging |
| `normal` | Standard reasoning depth (default) | General coding tasks |
| `none` | Direct responses without visible reasoning | Simple questions, quick edits |

### Environment Variable

You can also set the thinking level via environment variable, which is useful for IDE integrations:

```bash
AUTOHAND_THINKING_LEVEL=extended autohand --prompt "refactor this module"
```

### Integration with Pre-Prompt Hooks

Extended thinking works with the `pre-prompt` hook, so any context injected by hooks is available to the reasoning process.

---

## Session History

The new `/history` slash command provides paginated browsing of your session history, making it easy to find and resume past work.

### Usage

```
/history          # Show first page of session history
/history 2        # Show page 2
/history 3        # Show page 3
```

### Display Format

Each entry shows:

| Column | Description |
|--------|-------------|
| **ID** | Session identifier (truncated to 20 chars) |
| **Date** | Creation date and time |
| **Project** | Project name |
| **Model** | LLM model used (shortened) |
| **Messages** | Total message count |
| **Status** | Active session badge (green `[active]`) |

### Example Output

```
Session History

 ID                       Date                  Project           Model                       Messages
────────────────────────────────────────────────────────────────────────────────────────────────────────
 abc123def456...           Jan 15, 3:42 PM       my-project        claude-sonnet-4             24 msgs [active]
 xyz789ghi012...           Jan 14, 10:15 AM      api-server        gpt-4o                      18 msgs
────────────────────────────────────────────────────────────────────────────────────────────────────────

Page 1 of 3 (42 sessions)
Use /history 2 for next page
Use /resume <session-id> to resume a session
```

### Resuming Sessions

Combine `/history` with `/resume` for a smooth workflow:

```
/history            # Find the session you want
/resume abc123...   # Resume it
```

---

## Granular Auto-Approve (Yolo Mode)

Yolo mode provides pattern-based auto-approval of tool calls, giving you fine-grained control over what the agent can do without prompting. Combine it with `--timeout` for time-bounded autonomous sessions.

### Usage

```bash
# Auto-approve everything
autohand --yolo true

# Auto-approve only read and write operations
autohand --yolo 'allow:read_file,write_file,search'

# Auto-approve everything except delete and command execution
autohand --yolo 'deny:delete_path,run_command'

# Allow all operations, but only for 10 minutes
autohand --yolo true --timeout 600
```

### Pattern Syntax

| Pattern | Effect |
|---------|--------|
| `true` | Shorthand for `allow:*` -- approve everything |
| `allow:*` | Auto-approve all tools |
| `allow:read_file,write_file` | Auto-approve only the listed tools |
| `deny:delete_path,run_command` | Deny the listed tools, auto-approve the rest |

### How It Works

1. Autohand parses the `--yolo` pattern into a `YoloPattern` (mode + tool list).
2. When a tool call requires approval, Autohand checks whether the tool name matches the pattern.
3. If matched (in allow mode) or not matched (in deny mode), the tool executes without prompting.
4. If the pattern does not auto-approve the tool, the normal permission prompt is shown.

### Timeout Timer

The `--timeout` flag creates a `YoloTimer` that tracks remaining time:

```bash
# Auto-approve for 5 minutes, then revert to normal prompting
autohand --yolo true --timeout 300
```

- While the timer is active, matching tools are auto-approved.
- When the timer expires, all tool calls return to normal permission prompting.
- The `remainingSeconds()` method tracks how much time is left.

### Safety

- Yolo mode integrates with the existing permission system.
- Blacklisted operations (from `permissions.blacklist`) are still blocked even in yolo mode.
- The `deny` pattern lets you exclude dangerous operations explicitly.

---

## MCP Client Support

Autohand now includes a built-in MCP (Model Context Protocol) client that can connect to external MCP servers. This lets you extend Autohand with custom tools from databases, APIs, or any MCP-compatible service.

### Overview

MCP is an industry standard protocol for connecting AI agents to external tools. Autohand's MCP client supports:

- **stdio transport** -- spawns a child process and communicates via JSON-RPC 2.0 over stdin/stdout
- **SSE transport** -- connects to an HTTP server using Server-Sent Events
- **Streamable HTTP transport** -- connects via MCP's Streamable HTTP protocol with session tracking and dual-format response handling
- **Custom headers** -- pass authentication tokens and custom headers for HTTP/SSE servers
- **Automatic tool discovery** -- queries `tools/list` and registers tools dynamically
- **Namespaced tools** -- tools are prefixed as `mcp__<server>__<tool>` to avoid collisions
- **Server lifecycle management** -- start, stop, and reconnect servers
- **Non-interactive CLI management** -- add, list, and remove servers from the command line without entering the REPL

### Configuration

Add MCP servers to your `~/.autohand/config.json`:

```json
{
  "mcp": {
    "servers": [
      {
        "name": "database",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-postgres"],
        "env": {
          "DATABASE_URL": "postgresql://localhost/mydb"
        },
        "autoConnect": true
      },
      {
        "name": "custom-api",
        "transport": "sse",
        "url": "http://localhost:3001/mcp",
        "autoConnect": true
      },
      {
        "name": "context7",
        "transport": "http",
        "url": "https://mcp.context7.com/mcp",
        "headers": {
          "CONTEXT7_API_KEY": "ctx7sk-your-api-key"
        },
        "autoConnect": true
      }
    ]
  }
}
```

### Server Configuration Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | Yes | - | Unique server name |
| `transport` | `"stdio"`, `"sse"`, or `"http"` | Yes | - | Connection type |
| `command` | string | stdio only | - | Command to start the server |
| `args` | string[] | No | `[]` | Command arguments |
| `url` | string | sse/http only | - | Server endpoint URL |
| `headers` | object | No | `{}` | Custom HTTP headers (for http/sse transport, e.g. auth tokens) |
| `env` | object | No | `{}` | Environment variables for the server process |
| `autoConnect` | boolean | No | `true` | Connect automatically on startup |

### Tool Naming

MCP tools are namespaced to prevent collisions with built-in tools:

```
mcp__<server-name>__<tool-name>
```

For example, a tool called `query` from a server named `database` becomes `mcp__database__query`.

### Protocol Details

The MCP client uses a minimal JSON-RPC 2.0 implementation:

1. **Initialize** -- sends `initialize` request, waits for server capabilities
2. **Initialized notification** -- confirms handshake complete
3. **Tool discovery** -- calls `tools/list` to discover available tools
4. **Tool execution** -- calls `tools/call` to invoke tools with arguments
5. **Lifecycle** -- manages server process lifecycle (start/stop/reconnect)

### Slash Commands

Manage MCP servers directly from the REPL:

| Command | Description |
|---------|-------------|
| `/mcp` | Interactive server toggle list (enable/disable with arrow keys) |
| `/mcp add` | Browse and install from community MCP registry |
| `/mcp add <name>` | Search community registry for a server by name |
| `/mcp add <name> <cmd> [args]` | Add a custom stdio server to config and connect |
| `/mcp add --transport http <name> <url> --header "Key: value"` | Add a custom HTTP server with headers |
| `/mcp connect <name>` | Connect to a configured server |
| `/mcp disconnect <name>` | Disconnect from a server |
| `/mcp list` | List all tools from connected servers |
| `/mcp remove <name>` | Remove a server from config |

> `/mcp install` still works as a backward-compatible alias for `/mcp add`.

### Interactive Server Manager

Running `/mcp` opens an interactive Ink-based toggle list where you can enable and disable servers with arrow keys and space/enter:

```
MCP Servers
────────────────────────────────────────────────────────
▸ ● filesystem          enabled (5 tools)
  ○ github              disabled
  ● postgres            error

↑↓ navigate  ⏎/space toggle  q/esc close
```

### Community MCP Registry

`/mcp add` (formerly `/mcp install`) provides access to a curated registry of 12 MCP servers across 5 categories (Developer Tools, Data & Databases, Web & APIs, Productivity, AI & Reasoning). The registry is fetched from GitHub and cached locally for 24 hours.

The unified `/mcp add` command auto-detects intent:

- **No arguments** (`/mcp add`) -- opens the interactive community registry browser
- **Name only** (`/mcp add context7`) -- searches the community registry for that server
- **Name + command/URL** (`/mcp add mydb npx -y @mcp/postgres`) -- adds a custom server directly
- **With `--transport`** (`/mcp add --transport http ctx7 https://...`) -- adds a custom HTTP/SSE server

### Non-Interactive CLI Commands

Manage MCP servers from the command line without entering the REPL:

```bash
# Add an stdio server
autohand mcp add mydb npx -y @modelcontextprotocol/server-postgres

# Add an HTTP server with custom headers
autohand mcp add --transport http context7 https://mcp.context7.com/mcp \
  --header "CONTEXT7_API_KEY: ctx7sk-your-key"

# Add an SSE server with environment variables
autohand mcp add -t sse my-api http://localhost:3001/mcp -e "API_KEY=secret"

# List all configured servers
autohand mcp list

# Remove a server
autohand mcp remove context7
```

| CLI Command | Description |
|-------------|-------------|
| `autohand mcp add <name> <cmd/url> [args]` | Add a server to config |
| `autohand mcp add -t http <name> <url> --header "K: V"` | Add an HTTP server with headers |
| `autohand mcp list` | List all configured MCP servers |
| `autohand mcp remove <name>` | Remove a server from config |

### Streamable HTTP Transport

The new `http` transport implements MCP's Streamable HTTP protocol:

- Sends `Accept: application/json, text/event-stream` to support both response formats
- Tracks `Mcp-Session-Id` across requests for session continuity
- Parses both JSON and SSE-wrapped responses transparently
- Supports custom headers for authentication (API keys, bearer tokens, etc.)

### Non-Blocking Startup

MCP servers connect asynchronously in the background during startup. The prompt appears immediately without waiting for servers to finish connecting. Tools become available as servers come online. If the LLM invokes an MCP tool before connections complete, Autohand waits just-in-time.

### Validation

Server configurations are validated before connection. The client checks for:

- Non-empty `name` field
- Valid `transport` type (`stdio`, `sse`, or `http`)
- Required fields based on transport (`command` for stdio, `url` for sse/http)

> For full MCP documentation, see [docs/mcp.md](mcp.md).

---

## IDE Integration

The `/ide` command detects running IDEs on your system and enables integrated features. Autohand can detect which IDE is editing your current workspace and suggest relevant extensions.

### Supported IDEs

| IDE | Platforms | Extension Available |
|-----|-----------|---------------------|
| Visual Studio Code | macOS, Linux, Windows | Yes |
| Visual Studio Code Insiders | macOS, Linux, Windows | Yes |
| Cursor | macOS, Linux, Windows | No |
| Zed | macOS, Linux, Windows | Yes |
| Antigravity | macOS | No |

### Usage

```
/ide
```

The command performs the following steps:

1. Scans running processes for known IDE patterns
2. Reads IDE storage to determine which workspace each instance has open
3. Matches detected IDEs against your current working directory
4. Presents a selection modal for matching IDEs
5. Suggests extension installations for deeper integration

### Detection Details

- **Process scanning** -- uses platform-specific process name patterns (e.g., `Visual Studio Code` on macOS, `code` on Linux, `Code.exe` on Windows)
- **Workspace resolution** -- reads IDE state files to determine which directories are open
- **CWD matching** -- highlights IDEs that have your current workspace open

### Extension Suggestions

When an IDE has an available Autohand extension, the command shows installation hints with clickable terminal links:

```
Found 1 IDE matching your workspace:

  Visual Studio Code: /Users/you/project

Extension hint:
  Visual Studio Code: https://marketplace.visualstudio.com/items?itemName=AutohandAI.vscode-autohand
```

---

## Homebrew Installation

Autohand is now available via Homebrew on macOS:

```bash
# Install directly
brew install autohand

# Or via the official tap
brew tap autohandai/tap && brew install autohand
```

### Details

- Node.js is declared as a dependency and auto-installed if needed
- The formula installs from the npm registry
- Version is verified after installation via `autohand --version`
- Updates are available via `brew upgrade autohand`

---

## Plan Mode

Plan mode lets the agent plan before acting. When enabled, the agent uses only read-only tools to gather information and formulate a plan. Once you approve the plan, execution begins.

### Activation

Press **Shift+Tab** to toggle plan mode on/off. A status indicator shows the current state:

| Indicator | Meaning |
|-----------|---------|
| `[PLAN]` | Planning phase -- agent is gathering information and formulating a plan |
| `[EXEC]` | Execution phase -- agent is executing the approved plan |
| *(none)* | Plan mode is off -- normal operation |

### How It Works

1. **Toggle on** -- press Shift+Tab. The prompt shows `[PLAN]`.
2. **Planning phase** -- the agent can only use read-only tools (file reading, search, git status, web search, etc.). Write operations are blocked.
3. **Plan presentation** -- the agent presents a structured plan with steps.
4. **Accept options** -- choose how to proceed:
   - **Clear context and auto-accept edits** -- best for plan adherence, clears conversation history
   - **Manual approve** -- review and approve each edit individually
   - **Auto-accept** -- auto-accept all edits without review
5. **Execution** -- the indicator changes to `[EXEC]` and the agent executes the plan.

### Read-Only Tools in Plan Mode

During the planning phase, only these tools are available:

- File reading: `read_file`, `search`, `search_with_context`, `semantic_search`, `list_tree`, `file_stats`, `checksum`
- Git (read-only): `git_status`, `git_diff`, `git_diff_range`, `git_log`, `git_branch`, `git_stash_list`, `git_worktree_list`
- Web/Research: `web_search`, `fetch_url`, `package_info`, `web_repo`
- Memory: `recall_memory`
- Meta: `tools_registry`, `plan`, `ask_followup_question`

### Slash Command

You can also use the `/plan` slash command to interact with plan mode programmatically.

---

## Web Repo Tool

The new `web_repo` tool fetches repository information from GitHub and GitLab using the `@owner/repo` format. This gives the agent context about external repositories without leaving the terminal.

### Usage

Mention a repository in your prompt using the `@owner/repo` syntax:

```
Tell me about @vercel/next.js
```

The agent can also call the `web_repo` tool directly to fetch repository metadata, README content, and structure information.

---

## Auto Compact Context

Autohand now automatically compacts conversation context when sessions grow long. This prevents context window exhaustion and keeps the agent responsive during extended sessions.

### How It Works

- Enabled by default (`--cc` flag)
- Monitors conversation length relative to the model's context window
- When the conversation approaches the limit, older messages are summarized and compacted
- Works in both interactive and plan modes
- Critical information (file contents, recent tool results) is preserved

### Configuration

```bash
# Enable context compaction (default)
autohand --cc

# Disable context compaction
autohand --no-cc
```

---

## Custom System Prompt

Override or extend the default system prompt for specialized workflows.

### Replace Entire Prompt

```bash
# Inline string
autohand --sys-prompt "You are a Python expert. Be concise."

# From file
autohand --sys-prompt ./custom-prompt.md
```

When using `--sys-prompt`, the default Autohand instructions, AGENTS.md, memories, and skills are all replaced.

### Append to Default Prompt

```bash
# Inline string
autohand --append-sys-prompt "Always use TypeScript instead of JavaScript"

# From file
autohand --append-sys-prompt ./team-guidelines.md
```

When using `--append-sys-prompt`, the content is added at the end of the full default prompt. All default behaviors are preserved.

### File Path Detection

A value is treated as a file path if it starts with `./`, `../`, `/`, or `~/`, starts with a Windows drive letter, or ends with `.txt`, `.md`, or `.prompt`.

---

## New CLI Flags

| Flag | Description |
|------|-------------|
| `--thinking [level]` | Set reasoning depth: `none`, `normal`, `extended` |
| `--yolo [pattern]` | Auto-approve tool calls matching a pattern |
| `--timeout <seconds>` | Time limit for yolo mode auto-approve |
| `--cc` / `--no-cc` | Enable/disable automatic context compaction |
| `--search-engine <provider>` | Set web search provider (`brave`, `duckduckgo`, `parallel`) |
| `--sys-prompt <value>` | Replace entire system prompt (inline or file path) |
| `--append-sys-prompt <value>` | Append to the default system prompt |
| `--display-language <locale>` | Set display language (e.g., `en`, `zh-cn`, `fr`, `de`, `ja`) |
| `--add-dir <path>` | Add additional directories to workspace scope |
| `--skill-install [name]` | Install a community skill |
| `--project` | Install skill to project level (with `--skill-install`) |
| `mcp add <name> <cmd/url>` | Add an MCP server to config (non-interactive) |
| `mcp add -t http <name> <url>` | Add an HTTP MCP server |
| `mcp add --header "K: V"` | Pass custom headers for HTTP/SSE servers |
| `mcp list` | List configured MCP servers |
| `mcp remove <name>` | Remove an MCP server from config |

---

## New Slash Commands

| Command | Description |
|---------|-------------|
| `/history` | Browse session history with pagination |
| `/history <page>` | View a specific page of session history |
| `/ide` | Detect running IDEs and connect for integration |
| `/about` | Show information about Autohand (version, links) |
| `/feedback` | Submit feedback about the CLI |
| `/plan` | Interact with plan mode |
| `/add-dir` | Add additional directories to workspace scope |
| `/language` | Change display language |
| `/formatters` | List available code formatters |
| `/lint` | List available code linters |
| `/completion` | Generate shell completion scripts (bash, zsh, fish) |
| `/export` | Export session to markdown, JSON, or HTML |
| `/permissions` | View and manage permission settings |
| `/hooks` | Manage lifecycle hooks interactively |
| `/share` | Share a session via autohand.link |
| `/skills` | List, activate, deactivate, or create skills |
| `/mcp` | Interactive MCP server manager (toggle enable/disable) |
| `/mcp add` | Unified command: add custom servers or browse community registry |
| `/mcp add --transport http <name> <url>` | Add HTTP/SSE servers with headers |

---

## Architecture Improvements

### Modal Component

The `enquirer` dependency has been replaced with a custom `Modal` component built on Ink. This provides consistent styling, keyboard navigation, and better integration with the rest of the TUI.

### Extracted Modules

Several internal modules have been extracted for better separation of concerns:

- **WorkspaceFileCollector** -- handles workspace file discovery with 30-second caching
- **AgentFormatter** -- formats agent output for terminal display
- **ProviderConfigManager** -- manages provider-specific configuration logic

### Ink UI Rendering

The experimental Ink-based renderer (`ui.useInkRenderer`) has been optimized for:

- Flicker-free output via React reconciliation
- Working request queue (type while the agent works)
- Better input handling without readline conflicts

### Dynamic Help

The `/help` command now dynamically generates its output from the registered slash commands, so it always reflects the current set of available commands.

---

## Upgrading

### From npm

```bash
npm update -g autohand-cli
```

### From Homebrew

```bash
brew upgrade autohand
```

### Configuration Compatibility

Your existing `~/.autohand/config.json` is fully backwards-compatible. No migration is needed.

New configuration sections (like `mcp.servers`) are optional and only required if you want to use the corresponding features. Autohand uses sensible defaults for all new settings.

---

## Related Documentation

- [Configuration Reference](./config-reference.md) -- all configuration options
- [MCP Client Guide](./mcp.md) -- MCP server setup and transport details
- [Hooks System](./hooks.md) -- lifecycle hooks
- [Providers Guide](./providers.md) -- LLM provider setup
- [Auto-Mode](./automode.md) -- autonomous development loops
- [RPC Protocol](./rpc-protocol.md) -- programmatic control
