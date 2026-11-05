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

iTerm2 archives an erase-display operation into scrollback. Sending `CSI 2 J` before a full-screen repaint therefore accumulated entire old frames. Moving the cursor home without erasing rows prevented that accumulation but left stale composer rows when the window grew. The renderer now clears each visible row with cursor-addressed erase-line operations, then returns home and paints in the same synchronized write. It neither emits an intermediate empty frame nor uses erase-display for this resize reset. See [iTerm2's erase-display implementation](https://github.com/gnachman/iTerm2/blob/master/sources/VT100Screen/VT100ScreenMutableState.m).

The regression was reproduced in native iTerm2 3.7.7 with its Python API disabled: resizing increased the header, history marker, and draft counts from one to four. With the corrected renderer, each remained exactly one through four window sizes, including shrinking and growing. Screenshots and accessibility text were checked separately from the headless tests.

Compiled Bun executables also need to relaunch their real `process.execPath` inside tmux. Their virtual entrypoint (`/$bunfs/...` or `~BUN/...`) is internal to the executable and cannot be passed to a separate Bun process. Startup tests exercise a real compiled CLI rather than mocking this argument layout alone.

## Automated coverage

Install tmux locally, build the CLI, and run:

```bash
bun run build
bun run test:tuistory tests/tuistory/resize-flicker.tuistory.test.ts tests/tuistory/tmux-startup.tuistory.test.ts
```

The resize suite checks published terminal frames, idle and streaming output, full-screen and inline operation, multiline drafts, cursor retention, navigation, and clean Ctrl+C exits. Its terminal-name matrix checks protocol compatibility; it does not claim to run the named native application.

The tmux suite launches a compiled CLI through a real tmux server on a unique test socket. It checks current-directory, worktree, and Zit startup, retained input during resize, pane contents and scrollback size, and clean exit. It never uses or stops the user's tmux server. The suite is skipped on Windows, where tmux is not native. `AUTOHAND_TUISTORY_EXECUTABLE` can select an already compiled candidate; otherwise the test compiles the current source.

`.github/workflows/terminal-compatibility.yml` adds a separate macOS matrix for actual iTerm2, Ghostty, cmux, and VS Code applications. Tuistory runs an XCTest UI scenario against the shared renderer fixture. It resizes real windows, checks accessible terminal contents for duplicate transcript and composer markers, retains screenshots in an `.xcresult` bundle, and checks idle and streaming execution. The workflow records installed application versions alongside those results. Native GUI cases run only on disposable GitHub Actions macOS runners; the driver refuses to launch or terminate applications on a developer machine. iTerm2's Python API remains disabled.

Native CI availability and per-application results must be assessed from that workflow's completed jobs. A passing PTY suite or a successful XCTest build alone does not prove a native application passed. Failures in app launch, accessibility access, or window resizing fail the native job and preserve its XCTest evidence; they are not silently converted to headless passes.

The regular CI, full proof, and release terminal-test jobs install tmux explicitly. The native matrix runs for terminal-related pull requests and can also be invoked manually. It is separate from package publication.
