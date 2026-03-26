# Autohand in Chrome

Autohand in Chrome connects your CLI coding agent to a Chrome extension, giving it the ability to navigate pages, fill forms, capture screenshots, read network traffic, and debug — all from your terminal.

## How It Works

```
CLI (autohand)
  ├── /chrome command creates a handoff token
  ├── Opens Chrome with the Autohand side panel
  └── Communicates via native messaging (JSON-RPC 2.0)
        │
        ▼
Chrome Extension (side panel)
  ├── Receives instructions from CLI
  ├── Executes browser tools on the active tab
  └── Returns results back to CLI
```

The CLI and extension communicate through Chrome's native messaging protocol. A generated Node.js bridge process (`~/.autohand/chrome/native-host/host.js`) translates between Chrome's length-prefixed framing and the CLI's line-based JSON-RPC.

## Quick Start

### 1. Install the Extension

Install the Autohand Chrome extension from the Chrome Web Store or load it unpacked from your local build.

### 2. Connect from the CLI

```bash
# Start autohand
autohand

# In the REPL, run:
/chrome
```

Select **Open in Chrome** from the menu. This will:
- Install the native messaging host (if not already installed)
- Create a handoff token for the current session
- Open Chrome with the Autohand side panel

### 3. Use the Side Panel

Press **Cmd+E** (macOS) or **Ctrl+E** (Windows/Linux) to toggle the side panel. The extension will automatically attach to your CLI session.

## CLI Flags

```bash
autohand --chrome          # Start with browser bridge enabled
autohand --no-chrome       # Start with browser bridge disabled
```

## Slash Commands

| Command | Description |
|---------|-------------|
| `/chrome` | Open the Chrome integration panel with connection status |
| `/chrome disconnect` | Close the browser bridge and disable it |

## `/chrome` Panel

When you run `/chrome`, you see a panel with:

- **Connection**: `Connected` (green), `Disconnected` (yellow), or `Not installed` (red)
- **Status**: Whether the native host is installed
- **Extension**: Whether the extension profile was detected

### Options

| Option | Description |
|--------|-------------|
| **Open in Chrome** | Create a handoff and launch Chrome |
| **Manage permissions** | Open extension settings |
| **Reconnect extension** | Reinstall the native messaging host |
| **Enabled by default** | Toggle whether the bridge starts automatically with the CLI |

## Browser Tools

When connected, the agent gains access to these browser tools:

### Navigation & Interaction

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to a URL |
| `browser_click` | Click an element by CSS selector |
| `browser_type` | Type text into an input element |
| `browser_press_key` | Send a keyboard event (Enter, Escape, etc.) |
| `browser_scroll` | Scroll the page or to a specific element |

### Reading & Inspection

| Tool | Description |
|------|-------------|
| `browser_get_page_context` | Get page title, URL, headings, metadata, and body text |
| `browser_get_element` | Get computed styles, rect, and attributes of an element |
| `browser_find_element` | Find elements by selector, text content, or ARIA role |
| `browser_wait_for_element` | Wait for an element to appear (5s timeout) |
| `browser_screenshot` | Capture a screenshot of the current page |

### Debugging

| Tool | Description |
|------|-------------|
| `browser_read_console` | Read captured console messages (errors, warnings, info) |
| `browser_read_network` | Read captured network requests with filtering by URL, method, status |
| `browser_get_tabs` | List all open browser tabs |
| `browser_get_tab_groups` | List tab groups with their member tabs |

### Tool Examples

```
> Read the console errors on this page
  → agent calls browser_read_console with level: "error"

> What network requests are failing?
  → agent calls browser_read_network with status: "4"

> Fill in the login form with test@example.com
  → agent calls browser_type with selector: "#email", text: "test@example.com"

> Take a screenshot of the current page
  → agent calls browser_screenshot
```

## Configuration

Add to `~/.autohand/config.json`:

```json
{
  "chrome": {
    "extensionId": "your-extension-id",
    "enabledByDefault": false,
    "browser": "auto",
    "userDataDir": "/path/to/chrome/user-data",
    "profileDirectory": "Default"
  }
}
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `extensionId` | `string` | — | Chrome extension ID for direct handoff |
| `enabledByDefault` | `boolean` | `false` | Auto-start browser bridge with CLI |
| `browser` | `string` | `"auto"` | Preferred browser: `auto`, `chrome`, `chromium`, `brave`, `edge` |
| `userDataDir` | `string` | — | Browser user data directory |
| `profileDirectory` | `string` | — | Profile directory name (e.g., `"Default"`) |
| `installUrl` | `string` | — | Fallback URL when extension ID is not set |

## Connection Lifecycle

### Connecting

1. User runs `/chrome` → selects **Open in Chrome**
2. CLI creates a handoff token in `~/.autohand/chrome/handoffs/`
3. Chrome opens, extension attaches to the session via the token
4. Native messaging bridge forwards JSON-RPC between CLI and extension

### Disconnecting

The connection can be closed from either side:

**From CLI:**
```
/chrome disconnect
```

**From extension:**
Click the disconnect button in the side panel, or close the panel.

### Reconnecting

If the connection drops (CLI crash, browser restart, etc.):

1. The extension shows a **Connection lost** banner with the reason
2. Auto-reconnect attempts with exponential backoff (1s, 2s, 4s... up to 15s, max 10 attempts)
3. Manual retry via the banner's retry button or the header reconnect icon
4. Re-focusing the side panel also triggers a reconnect attempt

**From CLI:** Run `/chrome` again and select **Open in Chrome** to create a new handoff.

### Heartbeat

The extension sends a health check every 30 seconds. If the CLI doesn't respond within 10 seconds, the connection is marked as lost and auto-reconnect begins.

## Architecture

```
Chrome Extension                          CLI Process
┌──────────────┐                    ┌──────────────────┐
│  Side Panel  │◄──── Chrome ─────►│  Native Host      │
│  (UI + RPC)  │      Native       │  (host.js)        │
│              │      Messaging    │       │            │
│  Content     │      (4-byte LE   │       ▼            │
│  Script      │       + JSON)     │  autohand          │
│  (DOM tools) │                   │  --mode rpc        │
└──────────────┘                    │  (JSON-RPC 2.0)   │
                                    └──────────────────┘
```

- **Side Panel**: Main UI, sends prompts and receives responses
- **Content Script**: Runs on every page, executes DOM tools (click, type, find, etc.)
- **Background Worker**: Routes messages, handles context menus and shortcuts
- **Native Host**: Node.js bridge that translates Chrome native messaging to stdio
- **CLI RPC Mode**: The agent running in JSON-RPC server mode

## Permissions

Browser tool permissions follow the CLI's permission mode:

| Mode | Behavior |
|------|----------|
| **Interactive** | Agent asks before each browser action |
| **Full-auto** | Agent acts without asking |
| **Restricted** | Agent denies dangerous operations |

Site-level permissions are inherited from the Chrome extension's host permissions.

## Troubleshooting

### "Not installed" status

The native messaging host is not installed. Run `/chrome` and select **Reconnect extension**, or:

```bash
autohand --chrome
```

### "Disconnected" status

The CLI is running but no active handoff exists. Run `/chrome` → **Open in Chrome** to create one.

### Extension can't find the CLI

Make sure `autohand` is in your PATH, or set `cliPath` in the extension settings to the full path of the binary.

### Port conflicts

The OAuth callback server uses port 1455. If another process is using it:

```bash
lsof -i :1455
kill <PID>
```
