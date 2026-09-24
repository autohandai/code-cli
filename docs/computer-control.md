# Autohand Computer Use

Autohand Code can operate native applications on macOS, Windows, and Linux through **Autohand Computer Use**. Its independently built [computer-use component](https://github.com/autohandai/computer-use) is based on the MIT-licensed Cua engine. Ask in normal language:

```text
open my browser
go to Spotify and play Midnight City
switch to Slack and open Settings
scroll down in Chrome and tell me what is visible
```

The built-in `computer-control` skill activates for native GUI requests. Autohand discovers the requested application and window, observes current state, performs the requested input through its local computer use server, and verifies the visible result.

## Install and check

The Unix and Windows Autohand installers install Autohand Computer Use automatically. The npm package does the same during `postinstall`. An existing compatible engine is reused.

```sh
autohand computer status
autohand computer install
autohand computer doctor
```

`autohand computer install` downloads the pinned `0.28.2` engine archive from an immutable `autohandai/computer-use` component release, verifies the archive against a SHA-256 digest held by Autohand, and extracts only the expected runtime files. On macOS it also installs **Autohand Computer Use.app**. Use `--force` to repair a broken installation or replace a compatible version deliberately.

Autohand searches in this order:

1. an explicit `AUTOHAND_CUA_DRIVER_PATH`
2. the current `PATH`
3. a driver installed beside Autohand or in the npm package's `vendor` directory
4. the engine's platform defaults, including `~/.local/bin`, `~/.cua-driver/packages/current`, compatibility locations from older installations, and the Autohand Windows application directory

The detected engine is added to the running agent as the internal `cua-driver` stdio MCP server. On macOS, the MCP proxy starts an embedded daemon from Autohand Computer Use so macOS attributes Accessibility and Screen Recording to Autohand. This runtime entry is not written into `~/.autohand/config.json`, and an existing user-configured Cua MCP server takes precedence.

## Platform permissions

Run `autohand computer doctor` after installation and follow the platform guidance it prints.

- **macOS:** installation opens the Accessibility and Screen Recording requests for **Autohand Computer Use**. Approve the macOS prompts; System Settings then lists that exact product name. Existing `CuaDriver` rows from an older installation are no longer used by Autohand.
- **Windows:** Autohand installs the native x64 or ARM64 engine and its UI Automation helper under the Autohand application directory. The MCP process owns the interactive runtime for each session.
- **Linux:** Autohand installs the native x64 or ARM64 engine and its Wayland helpers. Run it inside the graphical desktop session; `doctor` reports any X11, Wayland, portal, or compositor requirement.

macOS requires the user to approve its protected permission prompts. Autohand opens the correct prompts during installation and does not require a separate driver setup command.

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

If you explicitly request one route, the agent follows that route. Otherwise, native application requests use Autohand Computer Use and web development diagnostics continue to use the browser tooling suited to that work.

## Disable or customize

Set `AUTOHAND_DISABLE_COMPUTER_USE=1` to stop automatic detection for a run. Setting `mcp.enabled` to `false` disables all MCP servers, including Autohand Computer Use.

Installers can skip the companion installation with:

```sh
AUTOHAND_SKIP_COMPUTER_CONTROL_INSTALL=1
```

For npm, `--ignore-scripts` skips all package postinstall helpers, including Autohand Computer Use and `ahtraces`. Run `autohand computer install` later to finish setup.

Autohand starts its managed engine in embedded `standard` permission mode and disables engine telemetry for that process. A manually configured Cua MCP server keeps the user's own arguments and environment unchanged.

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
