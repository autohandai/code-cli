# MCP (Model Context Protocol) Support

Autohand includes a built-in MCP client that connects to external MCP servers, extending your agent with tools from databases, APIs, browsers, and any MCP-compatible service.

## Table of Contents

- [Built-in Autohand Squad](#built-in-autohand-squad)
- [Overview](#overview)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Slash Commands](#slash-commands)
- [Official MCP Registry](#official-mcp-registry)
- [Tool Naming](#tool-naming)
- [Non-Blocking Startup](#non-blocking-startup)
- [Troubleshooting](#troubleshooting)

---

## Overview

MCP is an open protocol for connecting AI agents to external tools. Autohand's MCP client supports:

- **stdio transport** -- spawns a child process and communicates via JSON-RPC 2.0 over stdin/stdout
- **Streamable HTTP transport** -- connects to an MCP endpoint using HTTP JSON-RPC
- **SSE transport** -- not yet supported; use stdio or Streamable HTTP instead
- **Automatic tool discovery** -- discovers and registers tools from connected servers
- **Namespaced tools** -- MCP tools are prefixed to avoid collisions with built-in tools
- **Non-blocking startup** -- servers connect in the background without delaying the prompt

Stdio startup waits for the child process and the protocol handshake. Newline-framed responses decode complete byte frames, preserving UTF-8 characters split across reads. A newline frame exceeding 64 MiB closes the connection and rejects its pending requests with a size error; normal-sized screenshot and tool responses remain supported.
- **Interactive management** -- toggle servers on/off with the `/mcp` command

## Built-in Autohand Squad

Autohand Code adds `autohand-squad` to its runtime MCP servers automatically.
It uses this CLI's bundled stdio server, so no separate MCP install or saved
configuration is needed. Tools are available through normal tool discovery
and permission checks, under `mcp__autohand-squad__<tool>`.

Open the Squad app, then in an interactive CLI session:

```text
/squad                          choose an agent with the keyboard
/squad agents                   list agent IDs and presence
/squad select kai               select by ID or exact name
/message Please review this     message the selected agent
/message squad iris Review this message another agent explicitly
/squad history                  read the selected agent's replies
/squad queue                    inspect delivery receipts and pause state
/message team local Check this  message a local CLI teammate
/squad clear                    clear the selected desktop recipient
/squad app                      open or install the app
```

Selection belongs to the current CLI session. An explicit one-off recipient
does not change it. Local `/message <name> <text>` behavior continues when no
desktop recipient is selected. Escape cancels the picker and restores input.
Top-level `autohand squad` still opens the app; `autohand squad agents`,
`autohand squad message <agent-id> <text>` and `autohand squad history <agent-id>`
work without an interactive agent session. Legacy standalone runtime actions
remain available, including top-level `autohand squad queue`.

The server exposes 37 tools: the existing channel/run/goal tools plus direct messaging
(`message_member`, `get_conversation`, `get_member_queue`, `wait_for_message`),
published artifacts (`list_artifacts`, `get_artifact`) and the knowledge
library (`list_memories`, `read_memory`). These direct messages enter Squad's
durable conversation queue, wait behind busy work and retain saved member
permissions. A receipt means queued, not completed. Paused queues stay paused.
Repeat `wait_for_message` using the same receipt after a timeout; inspect the
queue before retrying a send whose response was lost. Creating members and
changing their models still happens in the app.

Member management is also built in: `get_member_profile`,
`update_member_profile`, `set_member_abilities`, `add_member_directory`,
`remove_member_directory`, `list_skills` and `set_member_skills`. Read the
saved revision before editing; pass `expected_revision` to reject stale
changes. Folder grants use the existing engine directory settings on later
turns; current work continues. Skill selection is distinct from installation
on the next turn. Policy edits preserve other settings and OS grants.

Channels support `get_channel`, `update_channel`, `set_channel_members`,
`list_channel_threads`, `create_group_chat` and `send_channel_message`.
Groups are private channels with at least two existing members. Creation
does not dispatch work. Sending dispatches only explicit `member_ids`;
omitting them posts without starting agents. Replies persist on the bridge
even after this CLI disconnects. Check per-recipient receipts before retrying.

Use `list_routines`, `get_routine`, `preview_routine`, `create_routine`,
`update_routine` and `run_routine` for scheduled work. Schedules require an
explicit IANA timezone. New routines default to disabled; set `enabled:true`
to schedule, `enabled:false` to pause, or run a saved routine manually.
These tools require an updated Squad bridge; older versions return an
upgrade instruction. The CLI never upgrades or restarts the app automatically.
The [canonical tool reference](https://github.com/autohandai/squad/blob/main/docs/integration/control-plane.md)
contains arguments and examples.

Use a current Squad release for Library tools; older app versions may lack
the artifact or knowledge-library endpoints. Updating the app does not
require reinstalling the CLI's built-in MCP.

Bridge discovery: explicit `AUTOHAND_SQUAD_BRIDGE_URL`, then
`$AUTOHAND_SQUAD_HOME/web-server.json` (default `~/.autohand/squad`), then
`http://127.0.0.1:19821`. Only loopback origins are accepted; redirects are
refused. MCP initialization succeeds while the app is offline, and calls
explain how to open it. Startup does not install or start Squad.

Disable with `AUTOHAND_DISABLE_SQUAD=1` or `mcp.enabled: false`. Bare, offline
and no-daemon sessions do not add this built-in server. An existing configured
`autohand-squad`/`autohand_squad` entry wins. A CLI launched as a managed Squad
member keeps its identity-scoped connection and never receives operator
access to another member's private memories.

For another MCP client, use `autohand squad mcp` as the command/arguments
(`--bridge http://127.0.0.1:19821` is optional). It emits protocol messages
only on stdout. See the [Squad control-plane reference](https://github.com/autohandai/squad/blob/main/docs/integration/control-plane.md)
for the complete tool schemas and scope.

---

## Quick Start

### Install from the Official MCP Registry

The fastest way to get started is installing a compatible server from the official MCP Registry:

```bash
# In the Autohand REPL, use an exact server ID returned by the registry
/mcp install io.example/my-server
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
| `transport` | `"stdio"` \| `"http"` | Yes | Transport type |
| `command` | string | Yes (stdio) | Command to start the server process |
| `args` | string[] | No | Arguments for the command |
| `stdioFraming` | `"content-length"` \| `"newline"` | No | JSON-RPC framing for stdio servers; defaults to Content-Length with automatic compatibility fallback |
| `url` | string | Yes (http) | Streamable HTTP endpoint URL |
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

### `/mcp install` -- Official Registry Browser

Browse compatible MCP servers from the official MCP Registry. The browser shows the current catalog page; direct installation accepts an exact registry server ID:

```bash
# Browse the full registry with categories
/mcp install

# Install a specific server directly
/mcp install io.example/my-server
```

The interactive browser shows:

- **Search** with autocomplete
- **Server details** before install (description, required env vars, required arguments)

Only entries Autohand can configure safely are shown: Streamable HTTP endpoints without custom headers or URL variables, and npm stdio packages. SSE, custom-header, and URL-template entries remain unsupported until their configuration requirements have a safe user flow.

#### Environment Variables

Some servers require environment variables. Set them in the shell that launches Autohand before installing; the installer validates their presence but never copies their values into configuration files:

```bash
export EXAMPLE_MCP_TOKEN='...'
/mcp install io.example/my-server
```

#### Required Arguments

Some catalog entries require positional arguments:

```bash
/mcp install io.example/my-server
# Prompts for each required argument
```

#### Agent Installation Tools

The agent can search the complete catalog server-side with `find_mcp_servers`, then request `install_mcp_server` for an exact catalog ID. Installation always requires approval, accepts neither arbitrary commands nor secret values, and refreshes available MCP tools after a successful connection.

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

### GitHub server using Docker

Check that `docker info` responds before reconnecting the MCP server. A running
Docker Desktop window does not prove its daemon is responsive. Restart Docker
only after accounting for other container work. The official
`ghcr.io/github/github-mcp-server` image is public. If pulling is denied, check
registry access and stored GHCR credentials; GitHub documents expired registry
tokens as one possible cause. Review the effect of `docker logout ghcr.io`
before using it because it changes stored registry authentication.
[GitHub server setup](https://github.com/github/github-mcp-server#local-github-mcp-server).

### Figma desktop server

Open a Figma Design file, switch to Dev Mode, and enable the desktop MCP server.
Configure Streamable HTTP at `http://127.0.0.1:3845/mcp`; `/sse` is not the
documented desktop HTTP endpoint. The app and server must remain running.
Autohand reports this guidance on local connection failure and leaves saved
configuration unchanged.
[Figma desktop setup](https://developers.figma.com/docs/figma-mcp-server/local-server-installation/).

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
