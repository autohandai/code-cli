# Full-screen mode implementation

- [x] Preserve committed main work and create an isolated full-screen integration checkout.
- [x] Define the full-screen scope, behavior and design.
- [x] Add failing tests for the registry, terminal ownership, viewport model and rendered frame.
- [x] Implement default-on feature wiring with explicit opt-out and shared alternate-screen lifecycle.
- [x] Implement bounded transcript rendering, paging, resize anchoring and search.
- [x] Integrate the existing composer, tool expansion and modal flows.
- [x] Document activation, keyboard controls, fallback and limitations in the config reference.
- [x] Validate focused unit/Ink tests, built-CLI Tuistory, lint and build; run full proof and record its result.
- [x] Commit the reviewed implementation on `full_screen_mode`.

## Validation — 2026-10-05

- Related UI/registry regression run: 389 passed, 4 skipped across 25 files. Startup configuration wiring also passed after correcting optional-config handling.
- Lint, type checking and the final ESM/CJS/declaration build passed.
- Final built-CLI Tuistory: 6 passed across the full-screen and existing compact-output scenarios. Covers paging, search, resize, draft editing, nested usage modal, persisted opt-in, expansion/collapse, provider tool-result preservation and exit.
- **Full proof is not green.** Its unit stage finished with 11,726 passed, 15 failed and 49 skipped across 825 files, so its automatic build/Tuistory stage did not run. Build and the focused terminal scenarios above ran separately.
- All nine failed files passed unchanged in a focused rerun (254 tests): `command.spec.ts`, `extensionsCliCommand.spec.ts`, `mcpClientManager.spec.ts`, `actions/command.coordination.test.ts`, `ui/discoveryProgressPty.test.ts`, `ui/inputPrompt.test.ts`, `core/agent/WorkspaceFileCollector.mobile-query.test.ts`, `modes/rpc/blueprintProcess.integration.test.ts`, and `ui/ink/peerComposer.pty.test.ts`. These reruns support intermittent execution failures; they do not replace a passing aggregate proof.

Full-screen mode is stable and enabled by default; explicit opt-out requires a restart. No release or remote push is part of this implementation.

## Interaction repair — 2026-10-06

- Shortcut help now opens above the composer in responsive Compose, Session and Transcript/History columns. It uses the active keybinding profile. Full-screen suggestion menus also open above the input, and the status bar retains its height.
- Hardware cursor coordinates include the measured full-screen footer origin, including after resize and popup layout changes.
- Mouse input respects the existing setting and terminal defaults. The wheel scrolls the transcript; click-to-edit includes the first visible row of a clipped multiline draft.
- `/about`, `/go`, and `/ps` outputs are explicitly marked as preformatted terminal content so Markdown cannot flatten logos, QR quiet zones, or numbered process rows.
- A new rendered shortcut snapshot and built-CLI scenarios cover wide/narrow help placement, cursor position, slash menus, mouse editing, multiline drafts, and `/status` modal return. The isolated `/status` test passes; the user-reported live-provider lockout has not been reproduced and is not claimed fixed.

Validation: 226 related unit/Ink tests passed, followed by 24 command-format/profile tests. Fourteen full-screen/caret Tuistory scenarios passed; the inline profile scenario and four targeted startup/slash/QR/process scenarios passed. The initial broader terminal run had 38 passed and 7 failed: four PTY startup timeouts, QR/process formatting failures corrected above, and a deep-research assertion that did not tolerate terminal word wrapping. The assertion now checks the same message and report path across wrapped whitespace, and the scenario passes. Lint, type checking and build passed. Native Ghostty GUI testing was unavailable; terminal claims are based on real PTYs.

Full proof completed in 13m33s with **11,734 passed, 9 failed, and 49 skipped** (826 files). It stopped in the unit stage, so the automatic whole Tuistory stage did not run. One failure used the old shortcut-history labels; the updated eight-test file passed. The eight failed files then ran in isolation: 185 passed and one command-coordination timing test failed. That final test passed individually both on unchanged main and in this worktree. These reruns do not turn the aggregate proof green. The final shortcut placement/caret check also passed at all three tested widths, and lint/type checking passed after the test expectation updates.


## Navigation and status protocol repair — 2026-10-06

- `/status` now parses complete and fragmented CSI sequences instead of consuming exactly three bytes. Enhanced Escape and Ctrl+C close the panel; encoded Tab/Shift+Tab navigate; key-release events do not activate actions. Timer/listener teardown is covered with fake timers.
- Unsupported and unimplemented slash-command diagnostics return through the normal transcript path so full-screen redraws retain them.
- History adds Ctrl+Home, reverse search with Shift+Enter, and an anchored new-activity/back-to-bottom line. Escape preserves overlay priority and remains available for interruption at the tail. Expanded tool views advertise only the navigation keys they handle.
- The specification now maps the requested full-screen interactions to concrete Autohand behavior and evidence.
- Built extension tests cover both inline and full-screen authoring and trusted views, plus a full-screen question followed by all six file-write approvals and subsequent typing. The question/approval flow passes with both legacy and enhanced Enter sequences. These use simulated provider responses and do not establish that the user's sustained live-provider freeze is resolved.

Validation: 126 focused unit/rendering tests passed. The full-screen/extensions/caret terminal run passed 24 scenarios; after the final tool-detail hint correction and a new end-to-end activity-indicator scenario, all 12 full-screen scenarios passed against the rebuilt CLI (26 unique focused terminal scenarios overall, including the enhanced-keyboard extension flow). Lint, type checking and build passed. The first aggregate run was deliberately stopped during review to correct the tool-detail shortcut hint; it is not counted as completed proof. A completed aggregate run then passed all 11,752 unit tests (49 skipped) and the build, but failed three terminal scenarios (289 passed, 2 skipped): research status rows, workflow help, and diff colours. All three reproduced independently.


## Retained output and formatting repair — 2026-10-06

- `/help` and `/?` return formatted content through the transcript without pausing the renderer. The help listing survives redraw and remains scrollable while the draft is editable.
- Deep-research status and workflow usage keep explicit terminal rows. Tester reports use Markdown hard breaks so status fields remain separate and evidence links still render.
- Compact previews measure visible terminal columns and preserve ANSI sequences when clipping. Short coloured diff lines retain punctuation; long wide-character text stays within the preview limit. No dependency was added.
- The formatting regressions were reproduced before implementation. The focused unit run passes 114 tests. All five focused built-terminal scenarios pass: retained help, research status in both modes, diff colours, and workflow help/execution/cancellation.
- Final `bun run proof` passed lint/type checking, then finished its unit stage with 11,754 passed, 9 failed and 49 skipped across 826 files. One failure expected the previous Markdown research-status format; its assertion now expects the terminal format verified by Tuistory. All six failed files then passed in a focused run: 264 passed, 1 skipped. The other eight failures passed unchanged and involved subprocess deadlines, command coordination, workspace scanning, file locking, and idle shell output. This rerun does not make the aggregate proof green.
- Because the failed unit stage prevented the automatic build/terminal stage, `bun run proof:build-tuistory --reporter=verbose` ran separately on the final source. The build and all 62 terminal test files passed: **294 passed, 2 skipped** in 25m59s. This includes all full-screen scenarios and the inline regressions. Native Ghostty GUI control and the sustained live-provider extension freeze remain unverified.


## Integration with current main — 2026-10-19

- Pending native workflow and terminal-test work on main was committed before integration.
- The original full-screen commits are merged with the current renderer, preserving session behavior, native workflow hooks, permissions, and framework versions.
- Queued Ctrl+Enter steering supports both Kitty and xterm encodings in the full-screen viewport; its message is recorded in the session before the next model request.
- Preformatted transcript rows use the existing `renderMarkdown` flag. Operational output keeps its layout, and tester/review workflow reports retain Markdown evidence links.
- Grouped shortcut help includes Ctrl+Enter. Failed renderer startup restores the keyboard protocol as well as the primary terminal screen.
- Removed queued goals retain their edit draft and show a warning immediately above the composer in both layouts; Enter cannot submit the missing goal. A real-terminal cross-process removal test verifies the composer stays anchored.
- Validation completed on 2026-10-20: lint, type checking, and the ESM/CJS/declaration build passed. The full unit stage passed **12,517 tests** across 876 files, with 73 tests skipped.
- **The aggregate `bun run proof` is not green.** Its complete terminal stage finished with **360 passed, 14 failed, and 2 skipped** across 79 files. Failures covered startup/input timing, shortcut/footer layout and resize observations, checkpoint completion, and temporary-session cleanup in six files.
- All six failed files then passed unchanged in a focused real-terminal rerun: **57 passed**. This includes every full-screen scenario, both inline and full-screen queued-steering encodings, feedback, lifecycle hooks, program status, and checkpoint completion. The rerun does not replace a passing aggregate proof or establish native Ghostty GUI/live-provider behavior.
