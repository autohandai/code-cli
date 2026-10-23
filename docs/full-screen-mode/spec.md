# Full-screen terminal mode

## Problem and outcome

Long conversations and tool output currently share the terminal's scrollback with a dynamic composer. The default full-screen mode owns a bounded terminal viewport: history scrolls above a composer that remains visible and editable.

## Activation

- Stable and on by default. Users opt out with `/experiments disable full_screen_mode` or `autohand experiments disable full_screen_mode`.
- Opt-out is stored as `features.fullScreenMode: false`; enabling or disabling requires restarting the interactive CLI.
- Only interactive TTY input/output with a usable terminal enables the mode. Piped output, RPC, ACP and `TERM=dumb` retain their existing behavior.
- Inline mode remains available through explicit opt-out.

## Required behavior

1. Keep the composer, draft, queue controls and status usable while output streams or grows beyond the terminal height.
2. Render only the visible transcript rows into Ink. Keep the canonical session transcript unchanged.
3. Page Up/Page Down browse history; Ctrl+Home jumps to the first message; Ctrl+End returns to the latest output. While browsing, show a back-to-bottom line above the composer and mark new activity. Escape closes menus first, then returns to the tail, then retains normal interruption behavior. New output follows the tail only when the user is already at the tail.
4. Preserve the message being read across terminal width changes and modal round trips.
5. Ctrl+F searches rendered transcript text without overwriting the composer draft. Enter advances through matches; Shift+Enter searches backward with wraparound; Escape leaves search.
6. Support Markdown, links and clickable image labels through the existing terminal formatter. Preserve compact tool previews and explicit expansion.
7. Keep slash-command menus, usage reports, permission prompts, feedback, queues and Ctrl+C behavior working. Restore the original terminal screen on shutdown, failed startup and process exit.
8. Honor the existing mouse setting and terminal defaults. When enabled, support click-to-position in the composer and wheel scrolling in the transcript. Keep keyboard navigation available when mouse capture is disabled. Show grouped shortcut help and suggestion menus above the anchored composer.
9. Do not change provider requests, token accounting, permissions, session storage or noninteractive output.

## Acceptance evidence

Tests cover default-on activation and explicit opt-out, persistence, TTY fallback, screen lifecycle and nested modals; transcript paging, streaming, resize anchoring and search; and built-CLI startup, long output, draft preservation, modal return and clean exit. Run focused tests, lint, build, Tuistory and `bun run proof`. Record aggregate failures separately from focused proof.

## Interaction parity acceptance matrix

The target is the full-screen terminal experience shown in the reference screenshots, adapted to Autohand's existing commands and extensions. Codex-specific product services are not required by this screen specification.

| Surface | Autohand behavior | Regression evidence |
| --- | --- | --- |
| Composer and status | Anchored while history streams, menus open, and terminal dimensions change | Full-screen and composer-caret Tuistory suites |
| History | Page navigation, first/latest, preserved reading anchor, new-activity indicator | Transcript model, rendered frame, full-screen Tuistory |
| Search | Separate query, next/previous match with wraparound, draft preserved on exit | Transcript and AgentUI tests, full-screen Tuistory |
| Shortcuts | Responsive groups above the input, active profile labels, Escape closes help first | Shortcut snapshot, AgentUI focus test, width-specific Tuistory |
| Mouse | Wheel scroll and click-to-edit, including clipped multiline drafts | Full-screen mouse Tuistory; native terminal behavior remains platform-dependent |
| Rich text | Markdown, clickable links/image labels, preformatted command output, expandable tool details | Markdown tests, ANSI preview tests, and full-screen help/about/output scenarios |
| Dialogs | Status tabs accept legacy and enhanced keyboard sequences and restore input | Status parser lifecycle tests and Ghostty-protocol Tuistory |
| Extensions | Builder questions, file approvals, trusted views, keybindings, disable/enable | Extensions Tuistory with simulated provider responses |
| Command diagnostics | Unsupported and unavailable command results survive transcript redraw | Slash dispatch and extension-disable Tuistory |
| Queue and cancellation | Existing queue-first and selected-message steering behavior; interruption remains available | Existing queue suites and full-screen focus tests |
| Default and opt-out | Full screen by default; `/experiments disable full_screen_mode` opts out after restart | Feature registry and persisted activation Tuistory |

Native Ghostty testing and the reported sustained extension freeze must be verified separately from simulated-provider terminal tests. This matrix does not claim an exhaustive port of undocumented Codex functionality. The reference for alternate-screen behavior and configurable Codex controls is the [official configuration documentation](https://developers.openai.com/codex/config-advanced/); the supplied screenshots define the requested layout.
