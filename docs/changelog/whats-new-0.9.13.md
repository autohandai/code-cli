# Autohand Code 0.9.13

### The mouse wheel scrolls the conversation

- In full screen the wheel now scrolls the transcript at all times, including while a turn is running and on iTerm2. It used to step through your prompt history instead.
- Mouse reporting stays on for as long as the full-screen view is open. `ui.mouseComposerCursor: false` still turns it off.

### Results that open where they are

- Click a result, or press Ctrl+O, and its details open in place. Close them and the transcript is back where you were reading, not at the bottom.
- A result that has more to show carries a hint row: "Click or Ctrl+O to expand" on the latest one, "Click to expand" on earlier ones.
- Ctrl+O closes the result that is open before it opens another.
- Script runs are labelled "Running script" and "Ran script", translated into every supported language, instead of `run_tool_script`.

### A turn that shows it has started

- `/goal <objective>` confirms the goal in one line, "Goal set · ...", that expands to the full record.
- The working status appears as soon as a turn is accepted. Hooks, permission checks and environment setup used to run first with an idle composer on screen.
- Text the model writes before calling a tool stays visible until the answer replaces it, instead of vanishing when the tool starts.
- The feedback question sits directly above the completion summary, without blank rows between them.

### Languages

- Kazakh (`kk`) is a new display language, detected from `LANG`/`LC_*` and listed in `/language` and the setup wizard.
- Portuguese (Brazil), Spanish, Korean, Japanese and Russian now translate every screen, including sign-in, workspace trust, setup and CLI help.

### Also in this release

- Switching to an Autohand AI model from the phone applies the reasoning effort chosen there.
- The status line and `/status` report the plan of the account you just signed in with.

- `/changelog` renders release notes as markdown.
- The startup update notice is delivered when the version check finishes before the agent is ready.
- A script result leads with what it did and a short preview; the full payload is behind the expand hint.
