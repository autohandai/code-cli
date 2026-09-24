# Native computer control

Autohand Code can operate native applications on macOS, Windows, and Linux through [Cua Driver](https://github.com/trycua/cua/tree/main/libs/cua-driver). Ask in normal language:

```text
open my browser
go to Spotify and play Midnight City
switch to Slack and open Settings
scroll down in Chrome and tell me what is visible
```

The built-in `computer-control` skill activates for native GUI requests. Autohand discovers the requested application and window, observes current state, performs the requested input through Cua Driver's local MCP server, and verifies the visible result.

## Install and check

The Unix and Windows Autohand installers install Cua Driver automatically. The npm package does the same during `postinstall`. An existing compatible `cua-driver` is reused.

```sh
autohand computer status
autohand computer install
autohand computer doctor
```

`autohand computer install` downloads the pinned Cua Driver `0.28.2` installer chain from the immutable GitHub release, verifies every installer script against hashes held by Autohand, and lets the upstream installer verify and install the platform release. Use `--force` to repair a broken installation or replace a compatible version deliberately.

Autohand searches in this order:

1. an explicit `AUTOHAND_CUA_DRIVER_PATH`
2. the current `PATH`
3. a driver installed beside Autohand or in the npm package's `vendor` directory
4. Cua Driver's platform defaults, including `~/.local/bin`, `~/.cua-driver/packages/current`, the signed macOS application, and the Windows local application directory

The detected driver is added to the running agent as the `cua-driver` stdio MCP server. This runtime entry is not written into `~/.autohand/config.json`, and an existing user-configured Cua MCP server takes precedence.

## Platform permissions

Run `autohand computer doctor` after installation and follow the platform guidance it prints.

- **macOS:** the upstream installer places the signed `CuaDriver.app` in `/Applications`. Grant Accessibility and Screen Recording to that stable app identity when macOS asks.
- **Windows:** the upstream installer installs the native executable and registers its interactive desktop service using its default autostart behavior.
- **Linux:** run Autohand inside the graphical desktop session. Cua Driver reports any X11, Wayland, portal, or helper requirement through `doctor`.

System permission prompts require the user. Autohand does not change OS privacy or security settings in the background.

## How a request runs

For a request such as “go to Spotify and play Midnight City,” the agent follows this sequence:

1. list running applications and launch Spotify only when needed
2. select the exact process and window
3. get fresh accessibility or visual state
4. use a current element token for the requested action
5. observe again and verify that the requested song is playing

The agent asks before purchases, sending messages or posts, deleting data, changing an account or security setting, changing system permissions, or expanding materially beyond the original request.

## Browser control

Native computer control uses the browser and profile already visible on the desktop. This is useful when the result depends on a signed-in local session or visible UI. Autohand's `/browser` extension bridge remains available for browser development, DOM inspection, console logs, and network diagnostics.

If you explicitly request one route, the agent follows that route. Otherwise, native application requests use Cua Driver and web development diagnostics continue to use the browser tooling suited to that work.

## Disable or customize

Set `AUTOHAND_DISABLE_COMPUTER_USE=1` to stop automatic detection for a run. Setting `mcp.enabled` to `false` disables all MCP servers, including Cua Driver.

Installers can skip the companion installation with:

```sh
AUTOHAND_SKIP_COMPUTER_CONTROL_INSTALL=1
```

For npm, `--ignore-scripts` skips all package postinstall helpers, including Cua Driver and `ahtraces`. Run `autohand computer install` later to finish setup.

Autohand starts its managed Cua MCP process in Cua's `standard` permission mode and disables Cua telemetry for that process. A manually configured Cua MCP server keeps the user's own arguments and environment unchanged.

## Troubleshooting

```sh
# Machine-readable installation state
autohand computer status --json

# Reinstall the pinned supported release
autohand computer install --force

# Use a specific existing executable for this process
AUTOHAND_CUA_DRIVER_PATH=/absolute/path/to/cua-driver autohand
```

If tools are unavailable in an already running Autohand session, install or repair the driver and start a new session so MCP tool discovery runs again.
