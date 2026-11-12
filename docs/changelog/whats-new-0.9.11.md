# Autohand Code 0.9.11

### More reliable long-running work

- Delegated agents have a configurable 30-request default through `agent.subagentMaxIterations`. Per-agent limits and lower per-call limits remain available. Exhausted agents return their partial findings with an explicit status instead of losing completed work.
- Code Mode preserves image evidence for the model while keeping script-visible image hints compact. Agent model and reasoning choices are respected, and research-only restrictions apply when explicitly requested.
- Completion review can continue with disclosed session evidence when capturing a large workspace diff exceeds its time budget. Required review and commit guards remain in place.
- ACP clients that support form elicitation can answer follow-up questions. Cancellations and retired sessions release the pending question safely.

### A steadier terminal and recoverable sessions

- Reduce duplicated resize frames and scrollback growth in iTerm2, keep drafts and cursor edits intact, and launch compiled executables correctly inside tmux. Plain `--tmux` uses the current folder; `--worktree` and `--zit` request isolation explicitly.
- Keep the composer editable while restoring a saved conversation, preserve early submissions, and wait for restored history before executing queued work.
- Recover usable project-history entries around malformed log rows. Storage-capacity errors stop automatic replay and explain that recent data may be unsaved.
- Start ordinary folder work without creating a Git repository. Initialize Git only when you choose to use it.

### Provider compatibility and local models

- OpenAI requests use compatible endpoints, completion limits, sampling and reasoning settings, preserve configured reasoning on custom endpoints, and recover once from an explicitly rejected token parameter.
- OpenRouter deadlines cover complete response bodies. Malformed historical tool calls remain available as readable context instead of being sent back as invalid native arguments.
- Use the context capacity reported by the running llama.cpp server while retaining explicit user limits and responsive startup.
- Avoid replaying an entire turn after a pre-request Azure Managed Identity failure. Official OpenCode Go endpoints receive the Autohand identity and an opaque per-conversation routing key.

### Safer tools and project paths

- Answer-only clients retain the development runtime commit identity in ordinary and worktree checkouts after Git packs its refs.
- Apply supported single-file anchored and numbered patches with clearer rejection diagnostics. Rewritten targets are checked again before authorization; ambiguous and no-op changes fail explicitly.
- A bare `--disallowed-tools '*'` blocks every tool, including automatic specialist dispatch. ACP reports whether the process activated this denial so constrained teaching clients can verify the boundary.
- Find built-in skills reliably from paths containing spaces or encoded characters. New Cursor imports retain complete encoded project paths and project-index associations; existing imported history remains untouched.

### Squad, search and skills

- Built-in Squad MCP supports direct agent messages, history and delivery receipts, agent profiles and abilities, project folders, skills, group chats, channel membership and scheduled routines.
- Choose the opt-in Keenable search provider in `/search`, onboarding or settings with your own API key. Keys stay masked in terminal settings.
- Discover installed skills through a compact name index and load descriptions on demand. Keep background sync off until explicitly enabled, and cancel queued and active sync work immediately when it is disabled.
