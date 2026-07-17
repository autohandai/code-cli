# Use Autohand Code in an ACP-compatible ADE

Autohand Code CLI includes a native [Agent Client Protocol (ACP)](https://agentclientprotocol.com/get-started/introduction) agent server. An agentic development environment (ADE), editor, or IDE that can launch a local ACP process over stdio can use Autohand directly. No adapter process or editor-specific plugin is required.

The native launch contract is:

```text
command: /absolute/path/to/autohand
args:    --acp
```

`autohand --mode acp` is equivalent to `autohand --acp`.

| Client | Native Autohand setup |
| --- | --- |
| Zed | Supported as a custom External Agent |
| JetBrains IDEs | Supported as a custom AI Assistant agent |
| JetBrains Air | Supported in preview builds that expose `Add ACP Agent` |
| GitHub Copilot app | No custom local ACP-agent launcher is currently documented |
| Other ADEs | Supported when the client can launch a local stdio ACP agent |

## What Autohand exposes over ACP

Autohand's ACP server supports:

- streamed agent messages, reasoning, tool calls, results, and cancellation
- interactive permission requests and session modes
- model selection plus thinking, auto-commit, and context-compaction controls
- new, loaded, listed, resumed, and forked sessions
- Autohand slash commands supported in non-interactive runtimes
- MCP servers supplied by the ACP client
- project working directories supplied by the client for each session

The client decides which protocol features it renders. A missing model picker or session control in one ADE does not mean the Autohand server lacks that capability.

## Prerequisites

1. Install Autohand Code CLI and confirm that it runs:

   ```bash
   autohand --version
   ```

2. Configure authentication and a model before starting Autohand from an ADE:

   ```bash
   autohand --setup
   # Or sign in to an existing configuration
   autohand --login
   ```

   Autohand reads its normal user configuration from `~/.autohand/config.json`, `config.toml`, `config.yaml`, or `config.yml`. Keep provider credentials there instead of copying secrets into an ADE's ACP configuration.

3. Find the executable's absolute path. GUI applications often inherit a smaller `PATH` than an interactive shell.

   macOS or Linux:

   ```bash
   command -v autohand
   ```

   Windows PowerShell:

   ```powershell
   (Get-Command autohand).Source
   ```

Use the returned path as `command` in the examples below. Typical resolved paths include `/opt/homebrew/bin/autohand`, `/home/alex/.local/bin/autohand`, and `C:\Users\alex\AppData\Local\autohand\autohand.exe`, but do not copy a guessed path.

## The universal local-process configuration

ACP standardizes the messages exchanged by a client and an agent, but clients can use different names for their configuration fields. A typical local-agent entry looks like this:

```json
{
  "agent_servers": {
    "Autohand Code": {
      "command": "/absolute/path/to/autohand",
      "args": ["--acp"],
      "env": {}
    }
  }
}
```

The invariant is the executable plus `--acp`. Translate `command`, `args`, and `env` into the client-specific schema when an ADE does not use `agent_servers`.

Autohand communicates using newline-delimited JSON over stdin and stdout. In ACP mode, stdout is reserved for ACP protocol messages and diagnostics go to stderr. Launch the binary directly when possible. A shell wrapper must never print banners, debug text, or other output to stdout.

## Zed

Zed supports custom ACP processes as [External Agents](https://zed.dev/docs/ai/external-agents).

1. Open `Agent Settings`.
2. Open `External Agents`, click `Add Agent`, and choose `Add Custom Agent`.
3. Add the following entry to the generated `agent_servers` object:

```json
{
  "agent_servers": {
    "Autohand Code": {
      "type": "custom",
      "command": "/absolute/path/to/autohand",
      "args": ["--acp"],
      "env": {}
    }
  }
}
```

4. Save the settings file, open the Agent Panel, and start an `Autohand Code` external-agent thread.

Use `dev: open acp logs` from Zed's command palette to inspect the protocol log. If Autohand is installed on a remote host, dev container, or SSH environment, the configured executable must exist in that environment rather than only on your local machine.

## JetBrains IDEs

Current JetBrains IDEs with AI Assistant can add a [custom ACP agent](https://www.jetbrains.com/help/ai-assistant/acp.html) to AI Chat.

1. Open the AI Chat tool window.
2. Open the menu in the upper-right corner and choose `Add Custom Agent`.
3. JetBrains creates and opens `~/.jetbrains/acp.json`.
4. Add Autohand under `agent_servers`:

```json
{
  "default_mcp_settings": {
    "use_custom_mcp": false,
    "use_idea_mcp": false
  },
  "agent_servers": {
    "Autohand Code": {
      "command": "/absolute/path/to/autohand",
      "args": ["--acp"],
      "env": {}
    }
  }
}
```

5. Save the file and select `Autohand Code` in AI Chat.

JetBrains can pass configured MCP servers or the integrated IntelliJ MCP server to ACP agents. Change `use_custom_mcp` or `use_idea_mcp` to `true` only when you want those additional tools exposed to Autohand.

Use `Get ACP Logs` from the AI Chat menu when diagnosing startup or protocol errors. JetBrains currently documents custom ACP agents as unsupported inside WSL; install and launch Autohand in a supported host environment instead.

## JetBrains Air

[JetBrains Air](https://blog.jetbrains.com/air/2026/03/air-launches-as-public-preview-a-new-wave-of-dev-tooling-built-on-26-years-of-experience/) is a fast-moving public preview. On builds that expose `Add ACP Agent`, open a project, choose that action from a new task, and add Autohand to the `acp.json` file Air opens:

```json
{
  "agent_servers": {
    "Autohand Code": {
      "type": "custom",
      "command": "/absolute/path/to/autohand",
      "args": ["--acp"],
      "env": {}
    }
  }
}
```

Preserve other entries already present in the file. Air's labels and managed file location may change during preview, but the Autohand process contract remains the same.

The local configuration launches the executable on the machine running the task. For Docker, remote, or cloud execution, install Autohand inside that execution environment and use the path visible there.

### Why Air may show a generic icon

An agent added directly to `acp.json` is a manually configured ACP agent. Air may show `Autohand Code` with its generic icon instead of a branded Autohand tile, even when the connection and model list are working correctly. The custom-agent configuration and ACP initialization handshake do not include a portable logo field.

Branded agent artwork is distributed separately through the [ACP Registry](https://agentclientprotocol.com/get-started/registry), where an agent can publish an `icon.svg`. Air's built-in `Add Agents` catalog and manually configured agents are different installation paths. Until an Air build offers Registry installation for Autohand, the generic icon is expected and does not indicate an ACP failure.

## GitHub Copilot app

The GitHub Copilot desktop app is an ADE, but its [published customization surface](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app) does not currently provide a launcher for arbitrary local ACP agent servers. Its custom agents, skills, plugins, and MCP servers extend the Copilot runtime; they do not replace Copilot with another ACP agent.

[GitHub Copilot CLI's `copilot --acp` option](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server) also makes Copilot an ACP **agent server**, which is the same protocol role as `autohand --acp`. It does not make the GitHub Copilot app an ACP client for Autohand.

Do not register Autohand as an MCP server in the Copilot app: ACP agent servers and MCP tool servers are different protocols. Autohand can be used there only after GitHub exposes a custom ACP-agent launch surface or another documented agent-provider integration.

## Any ACP-compatible ADE

For a future or custom ADE, verify that it can:

1. launch a local executable as an ACP agent over stdin and stdout
2. pass a project working directory when creating a session
3. keep the process alive for the session and close stdin during shutdown
4. leave stdout untouched and capture diagnostics from stderr
5. render or safely handle ACP permission requests

Then configure the executable as `/absolute/path/to/autohand` with `--acp` as its only required argument.

Autohand's native ACP entrypoint currently uses local stdio. An ADE that accepts only remote HTTP or WebSocket ACP agents cannot launch it directly. Remote workspaces and containers must install Autohand on the remote side and spawn it there.

## Optional launch settings

### Use a dedicated Autohand configuration

Add `--config` after `--acp` when the ADE should use a configuration other than the default user file:

```json
{
  "agent_servers": {
    "Autohand Code": {
      "command": "/absolute/path/to/autohand",
      "args": ["--acp", "--config", "/absolute/path/to/config.json"],
      "env": {}
    }
  }
}
```

### Supply a PATH only when necessary

An absolute `command` path is preferred. If Autohand launches other locally installed tools that the ADE cannot find, add a minimal `PATH` to the agent's `env` object. Preserve the system directories required on that operating system and never place provider keys in a shared project file.

### Choose a permission mode

Autohand starts ACP sessions from the `permissions.mode` value in its normal configuration and defaults to `interactive`. Compatible clients can also render Autohand's session modes: Interactive, Full Access, Unrestricted, Auto Mode, Restricted, and Dry Run.

Interactive mode sends risky actions to the ADE for approval. If the client cannot complete a permission request, Autohand denies the action by default. Use broader modes deliberately; they can allow file changes and command execution without per-action confirmation.

## Troubleshooting

### The ADE cannot find `autohand`

Use the absolute path returned by `command -v autohand` or `(Get-Command autohand).Source`. If the ADE runs remotely or in a container, run the lookup there.

### The agent starts but immediately requests authentication

Run `autohand --setup` or `autohand --login` in a normal terminal, complete provider configuration, and start a new ADE session. ACP mode does not open the interactive setup wizard on its protocol stream.

### Running `autohand --acp` appears to hang

This is expected when no ACP client is connected. The process waits for protocol messages on stdin and does not show Autohand's terminal UI. Verify `autohand --version`, then test ACP mode from the ADE.

### The client reports malformed JSON or a protocol handshake failure

Launch the Autohand executable directly. Remove shell startup output and wrappers that print to stdout. Check the client's ACP log and Autohand's stderr diagnostics.

### Tool calls are denied without showing a prompt

Confirm that the ADE implements ACP permission requests and that the session is in Interactive mode. A failed or unsupported permission request is denied safely. Restricted and Dry Run modes also deny mutating actions by design.

### The wrong project is opened

Start the ACP process and session from the intended project or worktree. Autohand uses the working directory supplied by the client for that session and applies its workspace safety gate when ACP mode starts.

## Upstream references

- [Agent Client Protocol introduction](https://agentclientprotocol.com/get-started/introduction)
- [ACP Registry](https://agentclientprotocol.com/get-started/registry)
- [Zed External Agents](https://zed.dev/docs/ai/external-agents)
- [JetBrains ACP configuration](https://www.jetbrains.com/help/ai-assistant/acp.html)
- [JetBrains Air public preview](https://blog.jetbrains.com/air/2026/03/air-launches-as-public-preview-a-new-wave-of-dev-tooling-built-on-26-years-of-experience/)
- [GitHub Copilot app customization](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app)
- [GitHub Copilot CLI ACP server](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server)
