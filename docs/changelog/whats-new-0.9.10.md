# Autohand Code 0.9.10

### Faster startup and a steadier terminal

- The composer appears before background MCP connections and repository snapshots finish. Resuming a saved session restores input readiness, keeps its conversation intact, and connects MCP servers in the background.
- Resize handling keeps clear and repaint output together, preserves multiline drafts and cursor placement, and reduces flicker during idle and streaming work.
- Ctrl+S steers queued input in terminals that cannot distinguish Ctrl+Enter. Steering preserves unrelated drafts and the remaining queue.
- Type `/` and use Up/Down to browse every matching command. The menu scrolls with the selection, and Tab accepts the highlighted command or subcommand.
- `/status` and `/sync` stay visible across terminal renderer handoffs, including sessions started with Bun.

### Skills and long-running tasks

- Opt-in adaptive skills keep the opening catalog small and load complete, pinned instructions when needed for a task. Loading receipts show which skill was used. Registry discovery and local skill creation remain available through `/skills`.
- Local learning drafts require configured acceptance checks and verified outcomes. Automatic learning and optional decision-model requests remain separately controlled and off by default. Saved goals retain reusable skill references and support explicit resumption.
- Programmatic tool dispatch uses stable tool contracts for long sessions. Specialist pre-run results are reused within the current turn, including partial and failed outcomes, and cleared for the next instruction.
- Unattended tasks stop at the first missing tool approval, print the denied tools and explicit-consent options, and exit with status 77. Nested agents and later specialist batches honor the same boundary. Expired YOLO time windows restore normal approval behavior.

### Safer edits, imports, and provider setup

- Direct mutation tools refuse to overwrite a fully observed file that changed after its read, including a revision that changes during hashing. Read the file again and incorporate the edit before retrying. Strict unread/partial-read enforcement remains optional.
- Claude imports translate supported user and project permission rules, preview changes with `--dry-run`, and retain local MCP configuration scope. Default Claude folder skills are discovered in place; alternate-profile packages are copied with their scripts and resources without overwriting existing packages.
- Configuration saves are atomic and preserve symlinked profiles. Background authentication checks preserve newer settings and logins from other terminals. Legacy 30-second defaults migrate safely, while settings and status show the active provider's timeout behavior. Credential settings include every supported third-party provider, including Sakana.
- Autohand account quotas and billing notices apply to the first-party Cloud provider without interfering with configured third-party inference providers.

### Session recovery and installation

- Settings sync transfers healthy data when an individual remote saved-session object is unavailable. It retains the affected session's local data and remote manifest records, reports incomplete history, and selects complete sessions within configured storage budgets.
- Web handoff explains empty or oversized conversations with actionable next steps and preserves the original local conversation.
- Fresh installations offer a useful orientation prompt for the current folder instead of a generic greeting.
- Optional Computer Use setup failures do not block npm installation. Release macOS artifacts require Developer ID signing and Apple notarization.
