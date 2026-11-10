# Terminal compatibility

Autohand uses Ink 7 and React 19. Full-screen output owns the alternate screen; inline output retains the terminal's normal scrollback. Terminal transport and workspace isolation are independent:

```bash
autohand --tmux
autohand --tmux --no-worktree
autohand --tmux --worktree my-task
autohand --tmux --zit
```

Plain `--tmux` runs in the current directory and does not require Git. `--worktree` and `--zit` opt into their respective workspace isolation. `--no-daemon` remains incompatible with `--tmux`.

## Resize regression

iTerm2 archives an erase-display operation into scrollback. Sending `CSI 2 J` before a full-screen repaint therefore accumulated entire old frames. Moving the cursor home without erasing rows prevented that accumulation but left stale composer rows when the window grew. The renderer now clears each visible row with cursor-addressed erase-line operations, then returns home and paints in the same synchronized write. It also translates Ink overflow resets into row erases and advances full-screen lines with cursor movement that clamps at the bottom row. This prevents a frame arriving before SIGWINCH has settled from scrolling into history. See [iTerm2's erase-display implementation](https://github.com/gnachman/iTerm2/blob/master/sources/VT100Screen/VT100ScreenMutableState.m).

The regression was reproduced in native iTerm2 3.7.7 with its Python API disabled: resizing increased the header, history marker, and draft counts from one to four. With the corrected renderer, each remained exactly one through four window sizes, including shrinking and growing. Screenshots and accessibility text were checked separately from the headless tests.

Compiled Bun executables also need to relaunch their real `process.execPath` inside tmux. Their virtual entrypoint (`/$bunfs/...` or `~BUN/...`) is internal to the executable and cannot be passed to a separate Bun process. Startup tests exercise a real compiled CLI rather than mocking this argument layout alone.

Startup authentication and Console connector synchronization can save configuration concurrently. Those writes wait up to five seconds for the configuration lock, so a brief competing write does not discard connector updates. Connector startup and later removal are checked through the running CLI even when file synchronization is unavailable.

## Automated coverage

Install tmux locally, build the CLI, and run:

```bash
bun run build
node --input-type=module -e "import { installZit } from './scripts/install-zit.mjs'; await installZit({ force: true });"
bun run test:tuistory tests/tuistory/resize-flicker.tuistory.test.ts tests/tuistory/tmux-startup.tuistory.test.ts
```

The resize suite checks published terminal frames, idle and streaming output, full-screen and inline operation, multiline drafts, cursor retention, navigation, and clean Ctrl+C exits. Its terminal-name matrix checks protocol compatibility; it does not claim to run the named native application.

The tmux suite launches a compiled CLI through a real tmux server on a unique test socket. It checks current-directory, worktree, and Zit startup, retained input during resize, pane contents and scrollback size, and clean exit. It never uses or stops the user's tmux server. The suite is skipped on Windows, where tmux is not native. `AUTOHAND_TUISTORY_EXECUTABLE` can select an already compiled candidate; otherwise the test compiles the current source.

`.github/workflows/terminal-compatibility.yml` adds a separate macOS matrix for actual iTerm2, Ghostty, cmux, and VS Code applications. Tuistory runs an XCTest UI scenario against the shared renderer fixture. It resizes real windows, checks accessible terminal contents for duplicate transcript and composer markers, retains screenshots in an `.xcresult` bundle, and checks idle and streaming execution. The workflow records installed application versions alongside those results. Native GUI cases run only on disposable GitHub Actions macOS runners; the driver refuses to launch or terminate applications on a developer machine. iTerm2's Python API remains disabled.

First-run dialogs are handled before fixture input. The offline fixture denies only the macOS request to find devices on local networks through XCTest's interruption handler. The handler checks accessibility values, titles, and labels: macOS permission text can have an empty label, while its visible text is in the value or title. The iTerm2 scenario opens a fresh window after handling interruptions, so a restored session cannot consume fixture input. All terminal text and resize assertions refer to the same window. Application termination and interruption-monitor removal use XCTest teardown blocks so failed assertions also release them.

VS Code uses separate disposable profiles for idle and streaming cases under a short `/private/tmp/ah-vsc-*` directory. Its [main IPC socket](https://github.com/microsoft/vscode/blob/main/src/vs/base/parts/ipc/node/ipc.net.ts) lives under the user-data directory, so putting profiles below a long checkout path can exceed macOS's Unix socket limit and make Code exit before creating a window. Settings evidence stays under the checkout's `.artifacts/native-terminal/` directory, and bounded main-log tails are attached to XCTest results. The profiles enable [`chat.disableAIFeatures`](https://code.visualstudio.com/docs/agents/reference/ai-settings) to suppress built-in Copilot onboarding. VS Code also launches with [`--force-renderer-accessibility`](https://www.chromium.org/developers/design-documents/accessibility/) to expose Chromium's native accessibility tree; the editor's screen-reader setting alone does not ensure that tree is available to XCTest. The scenario opens the terminal through its native Terminal > New Terminal menu. If the specific Copilot sign-in dialog still appears, the scenario closes that dialog and opens the integrated terminal. It does not sign in or grant network access. Window, workbench, and terminal-view failures preserve bounded accessibility diagnostics and screenshots; the workflow also retains the Xcode output and generated VS Code settings.

Native scenarios first size and position their fixture window within the reported display's visible bounds, leaving room for all four physical resize gestures. Setup shrinks oversized dimensions before moving the window, then grows it at the target position, so a full-width window's resize handle never moves off-screen. VS Code's input readiness uses the native Split Terminal command becoming enabled after New Terminal, which establishes terminal focus; it does not require xterm's input to expose the same TextView role as standalone terminals. The fixture's rendered output remains the mandatory proof that paste, Enter, and terminal rendering worked. All scenarios retain the exact transcript, streaming, draft, cursor, resize, and exit assertions.

VS Code's readout preflight captures one immutable native window snapshot and searches at most 2,048 nodes for a TextView buffer containing the real fixture-history marker. It does not concatenate workbench StaticText nodes: xterm exposes both individual screen rows and a live announcement region, which can repeat hundreds of full-screen redraw announcements. Those announcements are not the terminal buffer. The native snapshot avoids separate remote accessibility calls for every node and attribute; exceeding its traversal budget fails closed to the buffer-copy preflight. If accessibility lacks it, a disposable-profile shortcut uses [`runCommands`](https://code.visualstudio.com/docs/configure/keybindings#_running-multiple-commands) to select the full terminal buffer and [copy and clear its selection](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminalContrib/clipboard/browser/terminal.clipboard.contribution.ts). The preflight uses that raw copied buffer only if it contains the actual fixture marker and a second accessibility read still lacks it. Each subsequent copy clears the pasteboard and requires a new pasteboard generation; old frames cannot satisfy later resize checks. The command clears terminal selection while preserving focus and the PTY cursor, which the existing cursor-edit assertion verifies. No terminal output is filtered or deduplicated. Readout samples, selected backend, settings, and keybindings are retained with native results.

The strict visible-history assertions require room for both transcript exchanges and the multiline composer. At a compact 57×19 terminal, the full-screen transcript correctly follows its newest exchange and clips older rows; a separate PTY case checks that the history reappears on growth, the draft and cursor survive, and Ctrl+C exits cleanly. This distinguishes viewport clipping from lost transcript data. Native window references bind to their accessibility identities so later queries continue inspecting the resized window.

Native CI availability and per-application results must be assessed from that workflow's completed jobs. A passing PTY suite or a successful XCTest build alone does not prove a native application passed. Failures in app launch, accessibility access, or window resizing fail the native job and preserve its XCTest evidence; they are not silently converted to headless passes.

Development postinstall intentionally skips Zit downloads. The command above prepares its pinned, checksum-verified binary for the isolation tests; an existing installation can also be selected with `AUTOHAND_TUISTORY_ZIT_BIN`.

The regular CI, full proof, and release terminal-test jobs install tmux and prepare Zit explicitly. The native matrix registers the installed applications with Launch Services and targets their actual application URLs. It runs for terminal-related pull requests and can also be invoked manually. It is separate from package publication.
