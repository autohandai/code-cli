# Extending Autohand Code CLI

This document covers extension points intended for developers working inside the Autohand Code CLI codebase or building integrations around its Ink UI. Installable packages should use the trusted runtime surface documented in [Extension authoring](extension-authoring.md), including `api.ui.setStatusLine` and `api.ui.setHelpLine`.

## Status And Help Lines

The Ink UI exposes extension points for the fixed status line and the composer help line. Use these when a feature needs to add small, scannable state without rewriting the whole composer footer.

The shared types are exported from `src/ui/ink/index.ts`:

```ts
import type {
  AgentUILineExtensions,
  LineExtension,
  LineSegment,
} from "../src/ui/ink/index.js";
```

### Segment Model

Both lines use the same `LineExtension` shape:

```ts
interface LineSegment {
  id: string;
  text: string;
  color?: "text" | "muted" | "accent" | "success" | "warning" | "error" | "dim";
  visible?: boolean;
}

interface LineExtension {
  segments?: LineSegment[];
  replaceDefault?: boolean;
  separator?: string;
}
```

Segments with empty text, whitespace-only text, or `visible: false` are filtered out before rendering. By default, custom segments are appended after the built-in segments using the `·` separator. Set `replaceDefault: true` when the feature owns the full line for a mode or modal.

Use stable `id` values. They become React keys, so changing them on every render causes unnecessary footer redraws.

### Default Segments

The status line renders while Autohand Code CLI is working. Its built-in segment ids are:

| Segment   | Meaning                                      |
| --------- | -------------------------------------------- |
| `status`  | Current activity label                       |
| `metrics` | Elapsed time and token count, when available |
| `queue`   | Queued request count, when non-zero          |
| `cancel`  | Escape-to-cancel hint                        |

The help line renders below the composer while idle or working. Its built-in segment ids are:

| Segment        | Meaning                            |
| -------------- | ---------------------------------- |
| `provider`     | Current provider and model display |
| `context`      | Remaining context display          |
| `command-hint` | Shortcut and command hint          |

### Configure At Renderer Creation

Pass `lineExtensions` when creating the Ink renderer if the extension is known at startup:

```ts
import { createInkRenderer } from "../src/ui/ink/index.js";

const renderer = createInkRenderer({
  onSubmit: handleSubmit,
  onCancel: handleCancel,
  lineExtensions: {
    status: {
      segments: [{ id: "workspace-index", text: "indexing", color: "accent" }],
    },
    help: {
      segments: [{ id: "workspace", text: "repo: cli-3", color: "muted" }],
    },
  },
});
```

### Update At Runtime

Use the renderer setters when the extra line state changes during a session:

```ts
renderer.setStatusLineExtension({
  segments: [
    {
      id: "plan-mode",
      text: planModeEnabled ? "plan:on" : "",
      color: "accent",
    },
  ],
});

renderer.setHelpLineExtension({
  segments: [
    {
      id: "active-profile",
      text: `profile: ${profileName}`,
      color: "muted",
    },
  ],
});
```

To update both lines in one state transition, use `setLineExtensions`:

```ts
renderer.setLineExtensions({
  status: {
    segments: [{ id: "sync", text: "syncing", color: "warning" }],
  },
  help: {
    segments: [{ id: "workspace", text: workspaceLabel }],
  },
});
```

Pass `undefined` to clear the extension state:

```ts
renderer.setLineExtensions(undefined);
```

### Example: Session Diff Stats

Use a status-line extension for live session counters such as lines added and removed. If the counters are not self-explanatory in your flow, add a help-line segment that names the custom state.

Use `SessionDiffStatsTracker` to compute the numbers from the workspace. The tracker snapshots the current git diff and untracked files at construction time, so pre-existing dirty worktree changes are not counted as session changes. It counts tracked line changes from `git diff --numstat HEAD --` and counts lines in new untracked text files created after the baseline.

```ts
import { SessionDiffStatsTracker } from "../src/core/SessionDiffStatsTracker.js";
import { startSessionDiffLineExtension } from "../src/ui/ink/index.js";

const tracker = new SessionDiffStatsTracker(workspaceRoot);
const sessionDiffLines = startSessionDiffLineExtension({
  renderer,
  tracker,
  intervalMs: 1_000,
});

// Call this after a known file-changing action if you want immediate feedback
// instead of waiting for the next interval tick.
sessionDiffLines.refresh();

// Stop the interval during shutdown.
sessionDiffLines.stop();
```

With the default status line, a working turn might render as:

```text
Gathering context... · (12s · 4.2K tokens) · esc to cancel · +18 lines · -4 lines
```

The help line would still preserve the default provider, context, and command hint segments, then append:

```text
session diff: +18 / -4
```

### Replace The Defaults

Only replace defaults when the feature needs a fully custom line. This is useful for temporary modes where built-in provider, context, or cancel hints would be misleading.

```ts
renderer.setHelpLineExtension({
  replaceDefault: true,
  segments: [
    { id: "wizard-step", text: "setup: provider", color: "accent" },
    { id: "wizard-hint", text: "Enter to continue", color: "muted" },
  ],
});
```

### Formatting Helpers

For unit tests or non-Ink formatting, use the exported helpers:

```ts
import {
  formatLineSegments,
  resolveLineSegments,
} from "../src/ui/ink/index.js";

const text = formatLineSegments([{ id: "context", text: "70% context left" }], {
  segments: [{ id: "workspace", text: "repo: cli-3" }],
});

// "70% context left · repo: cli-3"
```

`resolveLineSegments` returns both the filtered segment list and the separator. Use it when a test needs to assert structure instead of final text.

### Guidelines

- Keep footer text short. The fixed bottom area has limited horizontal space.
- Prefer appending segments over replacing defaults so provider, context, queue, and cancel hints remain visible.
- Hide inactive state by returning an empty `text` value or `visible: false`; do not remove and recreate unrelated segments.
- Use colors for status, not decoration: `accent` for active state, `warning` for degraded state, `error` for failures, and `muted` or `dim` for supporting context.
- Keep segment ids stable across renders and unique within a line.
