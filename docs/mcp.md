# MCP (Model Context Protocol) Support

Autohand includes a built-in MCP client that connects to external MCP servers, extending your agent with tools from databases, APIs, browsers, and any MCP-compatible service.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Slash Commands](#slash-commands)
- [Community MCP Registry](#community-mcp-registry)
- [Tool Naming](#tool-naming)
- [Non-Blocking Startup](#non-blocking-startup)
- [Troubleshooting](#troubleshooting)

---

## Overview

MCP is an open protocol for connecting AI agents to external tools. Autohand's MCP client supports:

- **stdio transport** -- spawns a child process and communicates via JSON-RPC 2.0 over stdin/stdout
- **SSE transport** -- connects to an HTTP server using Server-Sent Events (planned)
- **Automatic tool discovery** -- discovers and registers tools from connected servers
- **Namespaced tools** -- MCP tools are prefixed to avoid collisions with built-in tools
- **Non-blocking startup** -- servers connect in the background without delaying the prompt
- **Interactive management** -- toggle servers on/off with the `/mcp` command

---

## Quick Start

### Install from Community Registry

The fastest way to get started is installing a pre-configured server from the community registry:

```bash
# In the Autohand REPL
/mcp install filesystem
```

This adds the server to your config and auto-connects it. You can also browse the full registry:

```bash
/mcp install
```

### Manual Configuration

Add an MCP server to `~/.autohand/config.json`:

```json
{
  "mcp": {
    "servers": [
      {
        "name": "filesystem",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/projects"]
      }
    ]
  }
}
```

Restart Autohand and the server connects automatically in the background.

---

## Configuration

### Config Structure

```json
{
  "mcp": {
    "enabled": true,
    "servers": [
      {
        "name": "filesystem",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        "env": {},
        "autoConnect": true
      }
    ]
  }
}
```

### Server Config Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique server identifier |
| `transport` | `"stdio"` \| `"sse"` | Yes | Transport type |
| `command` | string | Yes (stdio) | Command to start the server process |
| `args` | string[] | No | Arguments for the command |
| `url` | string | Yes (sse) | SSE endpoint URL |
| `env` | object | No | Environment variables passed to the server |
| `autoConnect` | boolean | No | Auto-connect on startup (default: `true`) |

### Global Settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mcp.enabled` | boolean | `true` | Enable/disable all MCP support |
| `mcp.servers` | array | `[]` | List of server configurations |

---

## Slash Commands

### `/mcp` -- Interactive Server Manager

Running `/mcp` with no arguments opens an **interactive toggle list**:

```
MCP Servers
────────────────────────────────────────────────────────
▸ ● filesystem          enabled (5 tools)
  ○ github              disabled
  ● postgres            error
    Connection refused

↑↓ navigate  ⏎/space toggle  q/esc close
```

- **Arrow keys** to navigate between servers
- **Space** or **Enter** to toggle a server on/off (connect/disconnect)
- **q** or **ESC** to close the list
- Error details shown when an errored server is selected

### `/mcp` Subcommands

| Command | Description |
|---------|-------------|
| `/mcp` | Interactive server toggle list |
| `/mcp connect <name>` | Connect to a specific server |
| `/mcp disconnect <name>` | Disconnect from a server |
| `/mcp list` | List all tools from connected servers |
| `/mcp tools` | Alias for `/mcp list` |
| `/mcp add <name> <cmd> [args]` | Add a server to config and connect |
| `/mcp remove <name>` | Remove a server from config |

### Examples

```bash
# Add a server manually
/mcp add time npx -y @modelcontextprotocol/server-time

# View all available tools
/mcp list

# Disconnect a server
/mcp disconnect time

# Remove a server permanently
/mcp remove time
```

---

### `/mcp install` -- Community Registry Browser

Browse and install pre-configured MCP servers from the community registry:

```bash
# Browse the full registry with categories
/mcp install

# Install a specific server directly
/mcp install filesystem
```

The interactive browser shows:

- **Categories**: Developer Tools, Data & Databases, Web & APIs, Productivity, AI & Reasoning
- **Featured servers** with ratings
- **Search** with autocomplete
- **Server details** before install (description, required env vars, required arguments)

#### Available Servers

| Server | Category | Description |
|--------|----------|-------------|
| filesystem | Developer Tools | Read, write, and manage files and directories |
| github | Developer Tools | GitHub repos, issues, and PRs |
| everything | Developer Tools | Reference MCP server for testing |
| time | Developer Tools | Time and timezone tools |
| postgres | Data & Databases | PostgreSQL database queries |
| sqlite | Data & Databases | SQLite database operations |
| brave-search | Web & APIs | Brave web search |
| fetch | Web & APIs | Fetch and parse web pages |
| puppeteer | Web & APIs | Browser automation with Puppeteer |
| slack | Productivity | Slack messaging |
| memory | AI & Reasoning | Persistent knowledge graph memory |
| sequential-thinking | AI & Reasoning | Step-by-step reasoning |

#### Environment Variables

Some servers require environment variables. When installing, Autohand prompts for any required values:

```bash
/mcp install slack
# Prompts for:
#   SLACK_BOT_TOKEN: xoxb-your-token
#   SLACK_TEAM_ID: T0YOUR_TEAM_ID
```

#### Required Arguments

Servers like `filesystem` require path arguments:

```bash
/mcp install filesystem
# Prompts for: allowed directory path
```

---

## Tool Naming

MCP tools are registered with a namespaced prefix to avoid collisions:

```
mcp__<server-name>__<tool-name>
```

For example, the filesystem server's `read_file` tool becomes `mcp__filesystem__read_file`.

When the LLM decides to use an MCP tool, Autohand automatically routes the call to the correct server.

---

## Non-Blocking Startup

MCP servers connect **asynchronously in the background** during startup. This means:

1. The prompt appears immediately -- no waiting for servers to connect
2. Servers connect in parallel, each independently
3. Tools become available as servers finish connecting
4. If a server fails, others continue normally (errors shown with `/mcp`)
5. When the LLM invokes an MCP tool, Autohand waits for connections to complete first

This behavior matches how Claude Code and similar tools handle MCP -- the user is never blocked by slow server startup.

---

## Troubleshooting

### Server won't connect

```bash
# Check status
/mcp

# Try reconnecting
/mcp disconnect <name>
/mcp connect <name>
```

### Common errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Command not found` | Package not installed | Run the `npx` command manually first |
| `Connection refused` | Server not running (SSE) | Verify the URL and server status |
| `Request timed out` | Server unresponsive | Check server logs, restart |
| `SSE transport not yet implemented` | SSE not supported yet | Use stdio transport |

### Server logs

MCP server stderr output is captured internally. If a server misbehaves, check if the underlying command works outside Autohand:

```bash
npx -y @modelcontextprotocol/server-filesystem /tmp
```

### Disabling MCP

Set `mcp.enabled` to `false` in your config to disable all MCP support:

```json
{
  "mcp": {
    "enabled": false
  }
}
```

Or set individual servers to not auto-connect:

```json
{
  "mcp": {
    "servers": [
      {
        "name": "filesystem",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem"],
        "autoConnect": false
      }
    ]
  }
}
```
