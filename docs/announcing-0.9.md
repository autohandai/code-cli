# Autohand Code CLI 0.9.0: A Better Terminal for Real Coding Work

Autohand Code CLI 0.9.0 is the release where the terminal experience grows up. The CLI keeps the same direct command-line feel, but the day-to-day work is smoother: a stable Ink interface, better provider setup, richer composer controls, Chrome automation, skill discovery, recurring jobs, code review flows, and a runtime that is easier to reason about when something goes wrong.

This post covers the major changes since v0.8.0 through the current 0.9.0 branch state on May 5, 2026. It is written as a launch post, so it focuses on what users and integrators will feel first. The lower-level point is simple enough: a lot of the branch work went into making the product less fragile under real terminal pressure.

## The Terminal Is the Product Surface Now

0.9.0 makes the Ink TUI the default interactive experience. That matters because the CLI is where Autohand users plan changes, review diffs, approve tools, switch models, run shell commands, paste context, and stay with long agent runs. If the terminal gets stuck, loses input, or redraws poorly, the agent feels worse than it is.

The 0.9.0 work moved the interactive path onto Ink 7 and React 19 expectations, then tightened the lifecycle around startup, rendering, raw mode, modals, resize, and shutdown. Slash commands that had drifted during the UI refactor now route correctly again. The composer no longer blocks after LLM turns or slash-command completion. Double Ctrl+C uses the quit flow. Exit output prints after the composer is torn down, which avoids stale UI fragments hanging around after a session closes.

A lot of this work is intentionally boring from the outside. You type, the cursor stays where it should, the menu appears, Escape closes the dropdown, paste does not break the prompt, and resize does not scramble the screen. That is the kind of boring we wanted.

## The Composer Got Much Better

The composer in 0.9.0 is closer to a real editor. Autohand added a TextBuffer model with insert, backspace, delete, Home, End, arrow movement, word wrapping, logical-to-visual cursor mapping, preferred-column movement, word navigation with Intl.Segmenter, dynamic height, literal multiline input, and Shift+Enter support.

That shows up in several places:

- file mentions update as soon as the buffer changes
- Tab acceptance uses the real cursor offset
- mention previews can refresh without waiting for a later React state flush
- shell suggestions can be accepted from the same composer flow
- multiline prompts and pasted blocks behave predictably
- large pasted blocks are capped before they blow up the UI or context

The release also adds $skill autocomplete. Type $ and the CLI can surface installed skills, show context, and inject the selected skill into the active prompt. That turns skills into a normal part of writing an instruction rather than something you have to remember, find, and paste by hand.

## Provider Setup Covers More Real Teams

0.9.0 expands the provider matrix and wires those providers through setup, configuration, model selection, docs, tests, and integration surfaces.

The release adds or improves support for Azure Foundry and Azure OpenAI, Vertex AI, Z.ai, Sakana.AI, xAI, Cerebras, NVIDIA AI Cloud, DeepSeek, OpenAI, OpenRouter, Ollama, llama.cpp, and MLX. The DeepSeek work in the current branch is especially complete: provider factory wiring, config parsing, setup wizard support, /model configuration, ACP model list updates, provider docs, config reference docs, i18n strings, tests, and default base URL handling.

A DeepSeek config can be as small as this:

~~~json
{
  "provider": "deepseek",
  "deepseek": {
    "apiKey": "your-deepseek-api-key",
    "baseUrl": "https://api.deepseek.com",
    "model": "deepseek-v4-flash"
  }
}
~~~

OpenAI users also get a more explicit auth choice. The setup flow can use either an API key or browser-based ChatGPT account auth. The CLI also has a mandatory login and registration path now, with retries, a welcome screen, a login/exit prompt, and better behavior when a browser opener is missing on Linux.

## Chrome Automation Is Built In

Autohand 0.9.0 adds a first-class browser path. Users can start with /browser, pass --chrome or --no-chrome, and connect the CLI to browser and extension workflows. The browser side includes tools for tabs, tab groups, network inspection, console inspection, extension bridge calls, and JavaScript execution.

The release also hardens the native host path. Argument filtering, shebang resolution, Linux browser fallback behavior, Bun path leakage, Node.js discovery in CI, module cache pollution, and native-host test stability all received attention. Browser bridge responses are routed back to RPC clients, and browser skills can be injected in RPC mode.

For people using Autohand in web-heavy projects, this changes the shape of a debugging session. The agent can inspect the browser, read console output, look at network traffic, and connect those observations back to code edits in the same run.

## Skills Move Into the Main Workflow

The skills system is more visible in 0.9.0. The /learn command can analyze a project, recommend skills, generate skills, update skill metadata, and report progress as it works. Catalog operations moved into /skills, so the split is cleaner: /learn helps with project-aware recommendations and generation, while /skills manages search, trending, removal, and feedback.

Skill safety also improved. The branch adds a SkillSecurityScanner, layered threat detection, security scores on community skill metadata, pre-learn and post-learn hook events, and skill telemetry. The agent now has a skill discovery tool path too, which avoids packing large catalogs directly into prompts.

The practical effect is that skills feel less like hidden configuration and more like part of the CLI's normal command language.

## Review, Repeat, and Automation Get Real Surfaces

0.9.0 adds /review and /pr-review, plus a code_review action type and tool definition. Review runs can fire hook events and receive context from slash command queues, RPC, and ACP. That gives code review its own flow instead of treating it as another generic prompt.

Recurring work also gets a real interface. /repeat supports interactive scheduling, --repeat supports non-interactive recurring mode, and the tool surface includes schedule listing, cancellation, cron creation, cron deletion, and schedule_triggered events for clients.

Tool execution learned how to run independent work in parallel while serializing mutating tools for safety. The branch adds a parallel execution engine, concurrency control, grouped output rendering, and tests for that behavior. Automation also grows through background shell commands, project tracker tools, team task tools, worktree session tools, notebook cell editing tools, sleep, skill discovery, and delegation guidance.

## Plan Mode and Auto Mode Are Cleaner

Plan mode now has a clearer contract. /plan and Shift+Tab line up in the Ink TUI, the visual state is explicit, the plan tool is only available in plan mode, and exit_plan_mode gives the workflow a cleaner end point. Plan instructions are only added when plan mode is active, which keeps normal prompts from carrying extra planning rules.

Auto mode received similar cleanup. /automode on and /automode off work interactively, --yolo is processed before RPC runtime creation, auto-commit can be approved in yes and non-interactive modes, and commit-message prompts respect --yolo. Non-interactive runs default toward completion unless the user asks for handoff.

## Permissions and Workspace Safety Are Stricter

Permissions in 0.9.0 are more consistent across interactive and non-interactive paths. Prefix-based folder permissions now handle directories correctly. Default yolo behavior for file tools is honored. Permission mode precedence was fixed. File tool defaults can be overridden in non-interactive flows. Tool suggestions can use the user's permission config.

Workspace access can also be requested dynamically for directories outside the default root. Path resolution received symlink protection and allowed-directory handling, file mutation hooks now include change type metadata, and diff display is available for mutation tools.

This is one of the more important parts of the release for trust. The CLI can do more, so the boundaries around what it may touch need to be clearer.

## The Runtime Is Easier to Maintain

The branch breaks major runtime responsibilities into smaller modules: agent orchestration, interactive lifecycle, UI runtime, command runtime, session accounting, context runtime, tool output runtime, project operations, typed instruction running, and tool loop signature helpers.

Context compaction moved into src/core/context/. Session cleanup is awaited before shutdown. Memory injection is trimmed during bootstrap. Image compression uses a multi-stage pipeline. Session diff line stats can enrich status rendering. Error classification no longer treats provider or model failures as context overflow.

Those changes make the codebase easier to test and review. They also reduce the chance that a UI fix accidentally changes provider behavior, or a context fix breaks command execution.

## Install, Docs, and CI Got a Pass Too

0.9.0 includes release and install work: automated npm publishing, release workflow fixes, tarball bundle installs with checksum verification, bundled ripgrep support, platform-specific ripgrep targets, Bun 2.0 CI updates, and deterministic proof behavior without auto-installs.

Docs were updated across README, provider docs, config reference, Chrome integration, Go SDK examples, shell tool analysis, tool gap analysis, extension guides, $skill docs, shell command docs, and previous release notes. Model examples now match the newer model families used by the codebase.

Testing and reliability work touched Vitest execution, proof timeouts, native-host tests, device auth mocks, Ink 7 test updates, raw-mode safety, EIO teardown handling, modal lifecycle, bracketed paste, terminal resize, provider error sanitization, and runtime error classification.

## Upgrade Notes

For most users, the big upgrade checks are straightforward:

- confirm your provider section in ~/.autohand/config.json or the project config file
- re-run setup if you want ChatGPT account auth or a newly supported provider
- test terminal automation that depended on older rendering behavior
- review permission settings if your workflows write outside the workspace
- use /repeat or --repeat for recurring work instead of external prompt loops
- use /browser or --chrome for browser-connected sessions

Ink must stay at version >=7.0.0 and React must stay at version >=19. The executable name remains autohand. The public product name in docs is Autohand Code CLI.

## What 0.9.0 Changes in Practice

The best way to describe 0.9.0 is through the work it makes less awkward. Start the CLI, pick a provider, paste a real prompt, mention a file, inject a skill, switch models, open Chrome, review a PR, schedule a follow-up, and let independent tools run side by side. The pieces now fit together better inside the terminal.

Autohand Code CLI has always been about keeping coding work close to the shell. 0.9.0 makes that shell session steadier, broader, and more useful for the kind of work that lasts longer than one prompt.
