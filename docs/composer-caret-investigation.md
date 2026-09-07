# Composer caret flashing repair

Investigated on 2026-09-07 using Ink 7.1.1 and the current local checkout.
Repaired on 2026-09-08.

## Finding

The composer loses its hardware cursor on sibling-only renders. Typing restores
the cursor, then a background spinner frame hides it again. The timing follows
React commits and spinner updates rather than a regular terminal blink cycle.

`src/ui/ink/InputLine.tsx` supplies the caret position through Ink's `useCursor`.
In Ink 7.1.1, `build/log-update.js` only honors that position when `cursorDirty`
is true, and clears the flag after each frame. A sibling spinner updates without
rerendering `InputLine`; its next frame treats the cursor as absent and emits
`ESC[?25l` without restoring it. Ink's `useCursor` hook publishes cursor intent
only when its owning component commits.

The installed `ink-spinner` dots animation updates every 80 ms. Removing
`InputLineWrapper` memoization alone would not cover spinner-local updates: the
minimal reproduction uses `InputLine` directly, without that wrapper.

Upstream source: [Ink 7.1.1 log-update](https://github.com/vadimdemedes/ink/blob/v7.1.1/src/log-update.ts)
and [useCursor](https://github.com/vadimdemedes/ink/blob/v7.1.1/src/hooks/use-cursor.ts).

## Reproduction

The reproduction now runs in the normal Tuistory suite as a regression test.

```sh
bun run build
bun run test:tuistory -- tests/tuistory/composer-caret.tuistory.test.ts
```

The built CLI scenario uses a local mock provider and a command held open by a
test-controlled completion signal, then types a draft while the command is
still running. It needs permission to
bind a loopback port. No real provider requests are required.

Observed results before any production change:

| Scenario | Visibility samples | Result |
| --- | --- | --- |
| Composer without animation | 12 visible / 12 | Pass |
| Same composer with sibling spinner | 0 visible / 12 | Fail |
| Built CLI, editing during a live command | 0 visible / 24 | Fail |

Samples were collected every 40 ms after typing. The regression sampler waits
for synchronized output frames to close before reading visible cursor state.
The minimized animated case
failed consistently in repeated runs. The complete three-case run took 7.82 s.
A second complete run reproduced the same results in 8.31 s. After the repair,
all four expanded cases passed in 29.62 s, including raw cursor-show assertions,
standard and incremental rendering, explicit hiding, unmount/remount, layout
changes, transcript writes, normal resizing, mid-draft editing, and clean exit.
The built CLI case also checks scrollback cursor suppression and resuming typing.
An isolated loader restored the original cursor logic in a test process: the
final sampler still failed with all 12 samples hidden, confirming it continues
to detect the defect without changing the shared installed dependency.

These are real PTY and terminal-emulator measurements with
`TERM_PROGRAM=iTerm.app`. They establish application-driven cursor loss, not
visual verification in the native iTerm2 application. iTerm2 profile settings
are not necessary to reproduce this defect; whether they amplify its appearance
remains unverified.

## Implementation

`scripts/ensure-ink-cursor-intent.mjs` repairs Ink 7.1.1's standard and incremental
renderers, including `sync()`, to retain the latest cursor intent independently
of the dirty flag. The flag still schedules cursor updates. Ink's existing
`useCursor` cleanup and explicit `undefined` intent continue to hide the cursor.

The repair runs in `postinstall` and is included in the npm package, so both
development and npm installations apply it. Ink is pinned to the existing
7.1.1 version; React is unchanged. The script rejects unexpected versions or
source shapes, is idempotent, and replaces the file atomically to preserve Bun
package-cache hardlinks. Revalidate and remove this compatibility repair when
adopting an upstream release that retains cursor intent.

No cursor timers, raw composer cursor writes, or terminal blink preferences are
introduced. The composer's existing scrollback and modal lifecycle policies
remain in control of cursor visibility.

## Validation

- Build and repository lint passed after the repair.
- 164 existing composer, scrollback, editing, and renderer pause/resume tests
  passed. All 24 installer tests passed in the final focused run.
- All four caret Tuistory tests passed. An npm tarball check confirmed that both
  install scripts are included.
- `CI=true bun run proof` passed lint and typecheck, then ran for over 18 minutes
  without completing the unit suite. It reported failures in typed-history PTY
  and standalone-model-catalog binary tests. This task's proof process was
  stopped; another concurrent proof run was left untouched. Aggregate proof is
  incomplete. The pre-repair proof run also failed on MCP and workspace-inventory
  checks. These results are separate from focused caret verification.
- Raw build, diagnostic, focused-test, lint, and proof logs are retained locally
  in `.tmp/caret-investigation/`.

## Separate existing edge case

Resizing the minimal fixture to a six-row terminal puts the cursor one row too
high in fullscreen output. The same test failed identically with the original
cursor logic restored temporarily, before restoring the repair. This positioning
issue remains outside the flashing fix. The regression suite covers ordinary
terminal resizing; native iTerm2 visual verification remains outstanding.
