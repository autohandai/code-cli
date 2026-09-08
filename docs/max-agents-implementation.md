# Native multi-agent delivery checklist

Worktree: `.worktrees/max_agents`; branch: `new_feature/max_agents`.
Base: `f708cbdc`. Existing work on `main` is outside this change.

## Acceptance criteria

- [x] One configurable per-session thread limit covers direct, parallel, nested, and team-process delegation. Default nine includes the lead; one disables children. Exhaustion cannot deadlock waiting parents. Capacity is released after success, failure, cancellation, spawn failure, and shutdown.
- [x] `features.multi_agent_v2.max_concurrent_threads_per_session` is validated, persisted, documented, and editable through `/settings`; maximum-reasoning selection shows the real configured usage warning.
- [x] Autohand AI native tools expose usable agent definitions, preserve isolated model/provider/reasoning assignment and tool-result history, propagate cancellation, and report actual child outcomes and usage. Provider replacement preserves lifecycle observers and shared capacity.
- [x] Teams deliver follow-up instructions, represent failures and cancellation truthfully, recover from process errors, and broker descendant capacity through the lead.
- [x] An advanced, bounded TUI displays delegated and team runs with parentage, status, model/provider, task, duration, usage, output, errors, and supported controls. It survives renderer remounts. Keyboard/detail/cancel/exit flows have real terminal coverage.
- [x] Squad's independent daemon/session boundary is explicit. Its displayed state comes from the real native contract, never inferred from launcher success. CLI session limits are not falsely claimed as global Squad limits.
- [x] Built-in specialists cover requirements, architecture, implementation, review, security, testing, cleanup, documentation, and release/operations with concrete ADLC/SDLC handoff contracts and language suitable for non-technical users through CTOs.
- [x] Parent and eligible child models can discover installed specialists and use exact-name, approved community installation from `autohandai/awesome-sub-agents`; local overrides and capability restrictions remain intact.
- [x] `/pr-review`, `/deslop`, and `/tester` are usable, scoped workflows with meaningful evidence, permissions, errors, help, and terminal tests.
- [x] Visual testing creates real Playwright screenshots/trace and animated WebP artifacts, preserves source evidence, and distinguishes successful execution, captured evidence, visual inspection, failure, and unavailable tooling. No automatic browser/dependency downloads.
- [x] Focused tests, lint, build, and complete `bun run proof` pass against the final state; scoped incremental commits include the required co-author trailer.

## Verification evidence

- Shared budget tests added first and reproduced the missing implementation.
- `SessionThreadBudget.test.ts`: 21 tests passing after implementation.
- Parent React loop: 34 tests pass, including red-to-green screenshot attachment and unavailable-image diagnostics before text-only persistence.
- Root budget, recorded Squad adapter, Squad command, and cancellable slash-operation checks: 42 tests pass together.
- Native delegation uses a real local HTTP server through the Autohand AI provider factory; success, provider failure, cancellation, model/reasoning selection, and tool-result identity are covered. This is not a production-service canary.
- Team-process tests cover attempt IDs, cancellation drainage, retry, and shared descendant capacity. Two fresh-build inspector terminal tests pass, covering real child IPC, nested cancellation, completed usage, provider failure, direct cancellation, recorded Squad state, and clean exit. A stale cancellation activity label was reproduced and corrected during terminal validation.
- Settings cover JSON/YAML/TOML, modal/direct editing, root-inclusive bounds, live config replacement, and rejected invalid remote updates. All three fresh-build maximum-reasoning and settings terminal checks pass.
- Catalogue tests cover live discovery plus bounded validated metadata caching, fresh installation content, provenance, tool restrictions, and local overrides.
- Browser fixtures exercise real installed Chromium, PNG frames, traces, animated WebP, failure, cancellation, and request boundaries. The built-CLI native capture retains three PNGs, a two-frame 1280×720 WebP, and a Playwright trace. The first and final PNGs were actually inspected: the expected white “Ready to save” state becomes blue with “Saved locally” after clicking Save. This verifies the deterministic fixture transition, not a live model's semantic review or another application's accessibility. Captures alone are never counted as visual confirmation.
- All three lifecycle terminal cases pass, including script evidence and ESC cancellation, missing Playwright, and real native screenshot delivery without embedded images in saved sessions. Trusted command metadata prevents unintended environment bootstrap; ordinary implementation requests retain existing setup behavior.
- Final authorization-focused validation passes 139 tests. Teammates use current lead capabilities, permission rules, client restrictions, and hooks; rewritten input is validated, stale attempts and disconnected leads fail closed, and unresolved interactive requests do not open uncancellable prompts. Root and direct-subagent prompts remain unchanged.
- Background cleanup passes 63 related tests, including six actual-process cases proving owned-process shutdown, cancellation, failure, late registration, and unrelated-process preservation.
- The final complete `bun run proof` exited zero on 2026-09-06: lint (zero errors, four pre-existing warnings), typecheck, 617 unit-test files with 9,057 passing tests (two files and 35 tests skipped), ESM/CJS/declaration builds, and all 21 terminal-test files with 107 passing tests. Unit execution took 154 seconds and terminal execution took 702 seconds. Proof used an isolated `AUTOHAND_HOME`, local mock provider servers, and installed Chromium/Playwright; it did not use production-provider credentials.
- An earlier aggregate run timed out before initial CLI output in an existing batched-read terminal case. That case passed four consecutive unchanged isolated reruns and then passed in the complete final proof. No assertion or timeout was weakened.
- Authentication tests persist fixture credentials only inside per-test temporary homes. Plan-storage tests cover both the configured home and an explicit non-default home, allowing aggregate proof to run with isolated application state.

## Incremental commits

- `407fafc5`: configurable session thread budgets and reasoning warnings.
- `2ea8f234`: specialist discovery, exact-name catalogue installation, and evidence-driven built-in handoffs.
- `3b53fafa`: bounded request-only screenshot observations and explicit provider transport capabilities.
- `4363f26a`: isolated authentication fixtures and configured-home regression coverage.

The integration commit containing this checklist completes the shared runtime,
team authorization and cleanup, run inspectors, lifecycle commands, terminal
scenarios, and user documentation. Every commit includes the required co-author
trailer.

No live production-provider canary, push, merge, or release is claimed.

## Verified boundaries

`/squad` launches the separate native Squad stack. Its daemon exposes run/status
records but does not currently implement the lead CLI's child-capacity broker.
Squad work must be labeled as independent sessions, not silently counted as
children of the current interactive lead.

The public community catalogue has markdown definitions plus `registry.json`;
agents are installation candidates until explicitly approved and installed.
Source: <https://github.com/autohandai/awesome-sub-agents>.
