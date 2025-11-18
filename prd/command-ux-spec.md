# Autohand Command UX Spec

## Goals

- Mirror the Codex/Gemini CLI experience with three command layers: slash commands, at-file references, and in-line shell commands.
- Provide a unified auto-completion framework that switches context based on the user’s prefix (`/`, `@`, `!`, etc.).
- Ensure confirmations for sensitive operations, consistent theming, and robust ignore-handling when referencing local files.

## Components & Hooks

### slashCommandProcessor
- Loads built-in slash command descriptors from `src/ui/commands`.
- Each command contains metadata (name, description, action type, confirmation requirement).
- Execution pipeline:
  1. Input parser detects `/` prefix.
  2. Completion provider suggests available commands.
  3. Processor invokes the action (e.g., open help dialog, toggle settings, send prompt).
  4. Optionally shows confirmation modal using standard UI container.
- Supports extending via local JSON definitions.

### atCommandProcessor
- Handles `@path` tokens within prompt.
- Resolves paths relative to workspace; respects `.gitignore` and `.autohandignore`.
- Reads file snippets with size guards; chunks content if necessary.
- Injects resolved content into the prompt context before LLM calls.
- Integrates with completion engine for live path suggestions and Tab autocompletion.

### shellCommandProcessor
- Detects shell-mode prefix (e.g., `` `cmd` `` or `!cmd`).
- Runs commands using the `runCommand` helper; streams stdout/stderr live to the Ink UI.
- Tracks active processes to support cancellation (ESC) and logs durations.
- Handles binary output by switching to pager or summarizing when necessary.

### commandCompletion
- Central orchestrator that tracks the active mode:
  - `/` → slash command completion.
  - `@` → path completion (delegates to `useAtCompletion`).
  - `!` or `` ` `` → shell completion.
  - default → prompt suggestions / history.
- Hooks into MentionPreview/Ink panel to display suggestions with keyboard navigation.

### completion rendering
- Generic `useCompletion` hook renders suggestions in a consistent panel with highlight/scroll support.
- Accepts theme-aware Colors object (see `src/ui/colors.ts`) to match the rest of the UI.

### dialogs & UI states
- DialogManager renders modals for confirmations, auth prompts, and slash-command-specific flows.
- QuittingDisplay takes over when the session is shutting down.
- Layout toggles between prompt view, dialog view, and command output view depending on state flags.

## Data Flow

1. **Input capture** → `commandCompletion` decides context (slash/at/shell/default) and shows suggestions.
2. **Submit** → processors run in order: slash (if `/`), at-command resolver (collect extra context), shell (if `!`), else pass to LLM planner.
3. **Execution** → ink status panel updates; context meter recalculates; dialog stack updated if confirmation is required.

## Files To Create
- `src/ui/commands/index.ts` (command registry)
- `src/ui/hooks/slashCommandProcessor.ts`
- `src/ui/hooks/atCommandProcessor.ts`
- `src/ui/hooks/shellCommandProcessor.ts`
- `src/ui/hooks/commandCompletion.ts`
- `src/ui/colors.ts`
- Dialog components (DialogManager, ConfirmationDialog, QuittingDisplay)

## Next Steps
1. Implement slash command registry + processor.
2. Port at-command resolver to dedicated hook with ignore-rule support.
3. Add shell command processor with streaming output.
4. Build completion orchestration (key handling + Ink-based suggestion UI).
5. Integrate dialogs and Colors theme for consistent look & feel.
