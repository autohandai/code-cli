# CLI Announcements — Design

**Date:** 2026-07-27
**Status:** Approved, ready for implementation planning
**Owner:** CLI

## Summary

Autohand already ships announcements to Desktop (Commander), the website, and Assembly.
The CLI is the only client that cannot receive them. This design adds a CLI consumer for
the existing `/v1/announcements` API: an inline block printed at launch, and a persistent
`announcement_line` above the composer status line.

Announcements are **mandatory**. No config key, environment variable, or CLI flag turns
them off. Individual announcements can be dismissed, which is a per-item action recorded
server-side, not a global opt-out.

No API change, no migration, and no admin change is required.

## What already exists

### API — `~/Documents/autohand/api`

`src/routes/announcements.ts`, backed by `src/db/migrations/025_announcements.sql`:

| Endpoint | Purpose |
|---|---|
| `GET /v1/announcements` | Published, in-window, targeted, not-dismissed announcements for the caller. Accepts `?clientType=&appVersion=&platform=` |
| `POST /v1/announcements/:id/seen` | Upserts `seen_at` and `last_step_seen` |
| `POST /v1/announcements/:id/dismiss` | Upserts `dismissed_at`; the item never returns from `GET /` |

All client endpoints sit behind `requireAuth` (Bearer or cookie session).

Targeting already supports `client_types_json`, `platforms_json`, and
`min_app_version` / `max_app_version`, so `clientTypes: ["cli"]` works with no schema
change. Results are ordered `priority DESC, created_at DESC`.

### Admin — `~/Documents/autohand/web/prototypes/dark-web-cli`

`src/components/admin/AnnouncementsManager.vue` already exposes a **`cli` client tab**
(alongside `website`, `commander`, and `assembly`). It mounts
`CommanderAnnouncementsEditor.vue`, which writes `clientTypes: [props.clientId]` on save.

**Authoring for the CLI is already possible today.** The CLI is the only missing piece.

### CLI — `cli-3`

Everything needed is in place:

- Mandatory auth gate before interactive mode; `config.auth.token` is always present
  (`AuthSettings.token`, `src/types.ts:396`)
- `src/features/RemoteFeatureFlagManager.ts` is a direct precedent for the whole
  fetch/cache/degrade shape: device id, TTL'd disk cache, short timeout, silent failure,
  `clientType=cli`
- `printWelcome()` (`src/index.ts:1679`) is where a launch block belongs
- `FixedBottom` (`src/ui/ink/AgentUI.tsx:2555`) renders
  `StatusSection` → `InputLine` → dropdowns → `HelpLineSection`.
  The announcement line goes directly above `StatusSection`.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | No global off switch; per-announcement dismiss | Keeps the channel mandatory without letting one stale item become permanent noise. Uses the `/dismiss` endpoint that already exists. |
| D2 | Launch presentation is an inline block in `printWelcome`, never a blocking modal | Non-blocking, scrolls away with history, needs no keypress. A blocking modal would hang `--prompt`, pipes, and CI without a hard bypass. |
| D3 | The line shows the single highest-priority announcement, persistently, including while working | No timers, no animation, no re-render churn next to a live spinner. |
| D4 | Dismissal via **both** a `/whatsnew` modal and an inline `Ctrl+X` | The modal is the discoverable, full-text path; the key is the fast path. |
| D5 | Media (`mediaUrl`, `posterUrl`) is ignored; text is rendered from title/description/CTA | The terminal renders neither images nor video. Avoids an API change. |

## Architecture

A new `src/announcements/` domain. Rendering is deliberately kept outside it.

```
src/announcements/
  AnnouncementClient.ts       HTTP only
  AnnouncementContent.ts      Pure mapping + sanitization
  AnnouncementStore.ts        Disk cache + local dismissal record
  AnnouncementManager.ts      The single surface the agent consumes
  renderLaunchAnnouncement.ts Returns string[] for printWelcome
  index.ts
```

### `AnnouncementClient.ts`

HTTP and nothing else.

```ts
GET {apiBaseUrl}/v1/announcements
  ?clientType=cli
  &appVersion={packageJson.version}
  &platform={process.platform}
Authorization: Bearer {config.auth.token}
```

- `apiBaseUrl` resolved exactly as `RemoteFeatureFlagManager.getApiBaseUrl` does:
  `config.api?.baseUrl || config.telemetry?.apiBaseUrl || 'https://api.autohand.ai'`
- 1500 ms `AbortController` timeout, matching the feature-flag client
- Any non-200, malformed body, timeout, or thrown error returns `null`. Announcements
  never surface an error to the user and never affect CLI behavior.
- `postSeen(id, lastStep)` and `postDismiss(id)` are fire-and-forget; failures are swallowed.

### `AnnouncementContent.ts`

Pure functions, no I/O, no React. Maps the API's media-first shape to CLI text.

- **headline** ← `announcement.title`
- **body** ← each step's `title` / `description`, in `step_order`; `mediaUrl` and
  `posterUrl` are discarded
- **cta** ← the first step with a `ctaUrl`, rendered as `→ {ctaUrl}` (prefixed with
  `ctaLabel` when present)
- An announcement with **no renderable text after mapping is dropped**. This also
  prevents a media-only Desktop announcement from leaking into the terminal via a
  legacy row with an empty `client_types_json` (the server treats empty targeting as
  "everyone", and the public response shape does not expose `clientTypes`, so the CLI
  cannot distinguish "targeted at cli" from "targeted at nobody in particular").

#### Sanitization

Announcement text is server-controlled, mandatory, and written straight to a terminal.
Unsanitized, a single bad row could emit `\x1b[2J`, reposition the cursor, or draw a
counterfeit composer prompt.

`sanitizeAnnouncementText()` runs **before any value reaches stdout or Ink**:

1. Strip ANSI escape sequences (reuse `stripAnsiCodes` from `src/ui/displayUtils.ts:17`)
2. Strip all remaining C0 and C1 control characters, including bare `\x1b`, `\r`, `\b`,
   and `\x07`
3. Collapse newlines and runs of whitespace to single spaces for line rendering;
   preserve paragraph breaks only in the block renderer
4. Hard-clamp each field: headline 120 chars, each body line 200 chars, CTA URL 300
   chars, and at most 8 body lines per announcement. Anything longer is truncated with
   an ellipsis, not rejected.

This is a security boundary, not a formatting nicety, and is tested as one.

### `AnnouncementStore.ts`

- Cache file: `~/.autohand/announcements.json`, via a new
  `AUTOHAND_FILES.announcementsCache` entry in `src/constants.ts:74` (sits alongside
  `featureFlagsCache`)
- Persists the last successful payload plus `dismissedIds: string[]`
- A corrupt or missing cache degrades to "no announcements" — never throws
- Local `dismissedIds` exist so a dismiss hides the item **instantly** and **stays hidden
  offline**, independent of whether the `POST /:id/dismiss` round trip succeeded

### `AnnouncementManager.ts`

The only surface the agent talks to. Constructed in
`src/core/agent/AgentDependencyComposer.ts`.

```ts
getActive(): CliAnnouncement[]   // sanitized, mapped, locally-undismissed
getTop(): CliAnnouncement | null // highest priority (server order preserved)
dismiss(id: string): Promise<void>
markSeen(id: string): Promise<void>
refresh(): Promise<void>
```

**When `markSeen` fires:** once per announcement per process, on first *render* — whichever
of the launch block or the announcement line displays it first. It is not re-sent if the
line stays visible, and it is never sent for an announcement the user never saw (for
example, the second-priority item that only the `/whatsnew` modal reveals — that one is
marked seen when the modal renders it). `lastStep` is sent as the highest step index
actually displayed.

## Rendering

### Launch block

Rendered by `renderLaunchAnnouncement()` and printed from `printWelcome()`
(`src/index.ts:1679`) after the greeting / model-status line and before the `Try:`
suggestions. It inherits the existing `process.stdout.isTTY` guard at the top of
`printWelcome`, so command mode, pipes, and CI print nothing.

```
autohand v0.9.14
Welcome back, Igor
model claude-opus-5 · cc on · ~/dev/cli-3

 ◆ What's new  ·  Voice dictation is here
   Hit Ctrl+V in the composer to dictate a prompt.
   Works offline with the local Whisper model.
   → autohand.ai/docs/voice

Try:
  /voice      Start dictating
  /model      Switch model
```

The block renders the **highest-priority announcement only**, matching the line. When more
are active it appends a `+N more · /whatsnew` hint rather than printing all of them, so a
backlog of announcements can never push the welcome output off screen.

**Known consequence — cache lag.** `printWelcome` runs before the background fetch
resolves; startup deliberately does not block on network I/O. The launch block therefore
renders from the *previous* session's cache. A newly published announcement first appears
in the announcement line (once the fetch lands mid-session), and in the launch block from
the next launch onward.

This is an accepted trade. Blocking startup on this request would undo the startup
parallelization work and is not worth a one-launch delay on a non-urgent channel.

### Announcement line

New `src/ui/ink/AnnouncementLine.tsx`, rendered in `FixedBottom`
(`src/ui/ink/AgentUI.tsx:2555`) immediately above `StatusSection`.

```
  ◆ Voice dictation is here — Ctrl+V in the composer   ^X hide  /whatsnew
⠋ Thinking… (12s · 4.2K tokens) · esc to cancel
╭──────────────────────────────────────────────────────╮
│ › add a test for the parser                          │
╰──────────────────────────────────────────────────────╯
  claude-opus-5 · 98% context left · / for commands
```

- Shows the highest-priority active announcement only. Server ordering
  (`priority DESC, created_at DESC`) is preserved, so priority is authored, not computed.
- Visible at all times, including while a turn is running.
- Truncated to terminal width using `string-width` (already a dependency; see
  `src/ui/textBufferLayout.ts:11`) so wide CJK and emoji measure correctly.
- **Returns `null` when nothing is active**, rather than reserving a blank row the way
  `StatusLine` does. `StatusLine` reserves height because its content toggles on every
  turn; an announcement line would otherwise cost every user a permanent terminal row for
  a rare event. Layout shifts once per session when an announcement arrives or is
  dismissed, not once per turn.
- Props are plain data (`text`, `hint`, `visible`). The component performs no fetching and
  holds no domain state.

**Line text format.** `◆ {headline}` followed by ` — {first body line}` when one exists,
then the hint `^X hide  /whatsnew` right-aligned. Truncation applies to the
headline-plus-body portion only; the hint is never truncated, because a dismiss
affordance the user cannot read is worse than a shorter message. On terminals too narrow
to fit the hint plus a meaningful headline (under 40 columns), the hint is dropped and
only the headline renders.

### `/whatsnew`

New `src/commands/whatsnew.ts`, registered in `src/core/slashCommands.ts`. No `/whatsnew`
or `/changelog` command exists today.

```
┌─ What's new ─────────────────────────────────┐
│                                              │
│ ❯ Voice dictation is here                    │
│   Hit Ctrl+V in the composer to dictate.     │
│   → autohand.ai/docs/voice                   │
│                                              │
│   Squad mode is out of beta                  │
│   Run /team to spin up parallel agents.      │
│                                              │
│ ↑↓ move  ·  enter dismiss  ·  esc close      │
└──────────────────────────────────────────────┘
```

- Lists every active announcement in full, all steps and CTAs
- `↑↓` navigate, `Enter` dismisses the selection, `Esc` closes
- Triggers `refresh()` on open, so it is also the manual way to pull new announcements
  into a long-lived session
- **Must** be wrapped in `onBeforeModal` / `onAfterModal`, like every other interactive
  slash command

### `Ctrl+X`

Handled in the `AgentUI` key handler. **Gated on the announcement line being visible**, so
it is a no-op at all other times.

Chosen because it is not a readline binding and not an emacs prefix. Currently claimed
bindings are `Ctrl+C` (clear input / exit), `Ctrl+D` (exit), `Ctrl+A` (line start,
`AgentUI.tsx:346`), and `Ctrl+E` (line end, `AgentUI.tsx:348`). `Ctrl+X` avoids those and
leaves the readline set (`Ctrl+K/U/W/R/N/P`) free for future use.

Dismissing advances the line to the next-priority announcement, or hides it.

## Refresh and offline behavior

- **Startup:** one background fetch, fired alongside the existing background auth/version
  work. Never blocks the prompt.
- **On `/whatsnew`:** an explicit refresh.
- **No polling timer.** A session left open for days will not pick up new announcements
  until `/whatsnew` or the next launch. Announcements are not urgent alerts, and a
  long-lived interval driving Ink re-renders is not worth the cost. Revisit only if a real
  need appears.
- **`--offline`:** suppresses the fetch, as it does for every other startup network
  operation. Cached announcements still render. This is offline behavior, not an opt-out.

## Non-opt-out, concretely

There is no `config.announcements.enabled`, no `AUTOHAND_NO_ANNOUNCEMENTS`, and no
`--no-announcements`. The only user controls are per-announcement dismissal (`Ctrl+X`,
`/whatsnew`) and the natural suppression in non-TTY contexts, where there is no UI to
render into.

No new privacy surface is introduced: the CLI already contacts the same host on startup
for feature flags, version checks, and device ping.

## Test plan

The repository requires a failing test before implementation, and Tuistory coverage for
TUI behavior.

**Unit — `AnnouncementClient`**
- non-200 response, malformed JSON body, request timeout, missing auth token
- correct query string (`clientType=cli`, `appVersion`, `platform`) and `Authorization` header
- `postSeen` / `postDismiss` swallow failures and never throw

**Unit — `AnnouncementContent`**
- steps with media but no text → announcement dropped
- announcement-level title present, steps text-less → still renders
- multi-step ordering respects `step_order`
- `ctaLabel` without `ctaUrl`, and vice versa
- overlong title / description clamping
- **sanitization: ANSI payloads (`\x1b[2J`, `\x1b[H`), bare `\x1b`, `\r`, `\x07`, C1
  controls** — asserting nothing escapes into rendered output

**Unit — `AnnouncementStore`**
- corrupt cache JSON, missing cache file, unwritable cache directory
- `dismissedIds` persist across loads and filter `getActive()`
- offline fallback returns the last good payload

**ink-testing-library — `AnnouncementLine`**
- renders the top-priority item
- truncates to width without breaking wide characters
- renders nothing (no reserved row) when there is no announcement
- drops the hint below 40 columns and still renders the headline

**Tuistory / pty**
- launch prints the block when a cached announcement exists
- `Ctrl+X` hides the line and leaves composer input untouched
- `/whatsnew` opens, dismisses, and closes cleanly, restoring the prompt
- no announcement → no extra row above the status line
- `--prompt` command mode prints no announcement output

## Files touched

**New**
- `src/announcements/{AnnouncementClient,AnnouncementContent,AnnouncementStore,AnnouncementManager,renderLaunchAnnouncement,index}.ts`
- `src/ui/ink/AnnouncementLine.tsx`
- `src/commands/whatsnew.ts`
- tests mirroring the plan above

**Modified**
- `src/constants.ts` — add `AUTOHAND_FILES.announcementsCache`
- `src/index.ts` — print the launch block in `printWelcome`; kick off the background fetch
- `src/ui/ink/AgentUI.tsx` — render `AnnouncementLine` in `FixedBottom`; handle `Ctrl+X`
- `src/core/slashCommands.ts` — register `/whatsnew`
- `src/core/agent/AgentDependencyComposer.ts` — compose `AnnouncementManager`
- `src/core/agent/AgentUIRuntime.ts` — push announcement state into the UI

## Out of scope

- Relaxing `stepInputSchema.mediaUrl` from required to optional in the API, so a CLI
  announcement does not need a decorative image nobody will see. Worth a separate API
  ticket; not required for this work.
- Adding `clientTypes` to the public `GET /v1/announcements` response shape, which would
  let the CLI distinguish "explicitly targeted at cli" from "untargeted". The
  renderable-text filter covers the practical case.
- Rendering images via terminal graphics protocols (kitty/iterm2 inline images).
- Any polling or push channel for mid-session delivery beyond `/whatsnew`.
