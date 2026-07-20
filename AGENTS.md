# AGENTS.md

This file helps Autohand understand how to work with this project.

You are a critical, staff-level software engineer writing production-grade TypeScript for CLI tools.
Your work must be built with reliability, maintainability, and scale in mind.

1M users depend on this software.
Code quality, test coverage, and runtime stability are mandatory.

We use Ink for TUI.
Required version: `>=7.0.0`
React version: `>=19`
These versions must never be downgraded.

Ink docs:
https://www.npmjs.com/package/ink
https://github.com/vadimdemedes/ink/tree/master/examples

---

## Project Overview

- **Language**: TypeScript
- **Framework**: React + Ink
- **Package Manager**: bun
- **Test Framework**: Vitest
- **Build Tool**: tsup

## Current Repository Architecture

### `src/core/agent` runtime split (current)

The interactive runtime is now split across `src/core/agent` into focused layers:

- `src/core/agent.ts` — `AutohandAgent` public surface and top-level execution entrypoint.
- `src/core/agent/AgentLifecycleRunner.ts` — run mode orchestration (interactive, command mode, initialization, cleanup, signal handling).
- `src/core/agent/InputTurnCoordinator.ts` — input capture, queueing, ESC/Ctrl+C handling.
- `src/core/agent/AgentDependencyComposer.ts` — dependency wiring (`initializeAgentDependencies`) and runtime host setup.
- `src/core/agent/AgentContextRuntime.ts` — session bootstrap and context snapshot construction.
- `src/core/agent/SystemPromptBuilder.ts` — system prompt assembly and prompt-shaping.
- `src/core/agent/ReactLoopRunner.ts` — tool-call driven execution loop and response orchestration.
- `src/core/agent/InstructionRunner.ts` — single-instruction orchestration and completion flow.
- `src/core/agent/AgentCommandRuntime.ts` — slash command handling and execution.
- `src/core/agent/AgentProjectOperations.ts` — project-level operations (diff/commit/bootstrap quality hooks).
- `src/core/agent/AgentUIRuntime.ts` — composer/TTY/prompt UI state updates and status messaging.
- `src/core/agent/AgentSessionAccounting.ts` + `src/core/agent/AgentToolOutputRuntime.ts` — tool accounting, logging, and output shaping.
- `src/core/agent/ProviderConfigManager.ts` / `WorkspaceFileCollector.ts` / `AgentProjectOperations.ts` — feature-specific adapters and support services.

### General layout guidance for contributions

- Keep changes in `src/core/agent` scoped to the correct layer:
  - orchestration vs input vs tool-execution vs UI rendering.
- New behavior should prefer introducing or extending a focused module in `src/core/agent` before broadening into shared runtime or UI layers.
- When touching cross-layer behavior, update the owning module in this list and any adjacent coordinator in this section.

---

## Commands

- **Install**: `bun install`
- **Dev**: `bun dev`
- **Build**: `bun build`
- **Test**: `bun test`
- **Lint**: `bun lint`
- **Proof**: `bun run proof`

Never skip `bun run proof` after completing work.

All work must finish with:

1. tests
2. lint
3. proof

---

## Engineering Workflow

Follow this order strictly:

1. inspect existing implementation
2. inspect existing tests
3. write failing test first
4. implement minimal fix / feature
5. run tests
6. run lint
7. run proof
8. verify no regression

Do not write code before understanding the existing structure.

Always prefer extending existing modules over creating new files unless architectural boundaries require it.

### Failing Test Fix Workflow

When fixing failing tests or a user-reported regression, follow this directive:

1. replicate the error reported by the user by writing a failing test
2. if the error is successfully replicated, implement the solution and update the test only as needed for the corrected behavior
3. write the use case as a Tuistory test when the behavior is TUI, CLI startup, interactive terminal, command-help, prompt, menu, or screen-transition related
4. confirm the fix through the relevant Tuistory test before final validation whenever a Tuistory use case applies
5. create a commit after validation

Rules for creating the commit after validation:

- Commit messages must be meaningful and objective, written like a staff-level software engineer.
- Do not use abbreviated conventional prefixes such as `fix:`, `feat:`, or `bug:`.
- Add a short description of the changes like a Staff level engineer would do.
- If you're fixing github issue, mention the issue id in the commit message, but do not start the message with the issue id.
- Keep the existing co-author trailer requirement for every commit.

---

## Testing

This project uses **Vitest**.

### Mandatory Rules

- write tests before implementation
- bug fixes must begin with a failing test
- test critical paths and edge cases
- use `describe` and `it`
- mock external dependencies when needed
- no untested production code

### Ink / TUI Testing

For all TUI features:

- use `ink-testing-library` for component and rendering tests
- use `node-pty` for real terminal interaction tests
- validate actual terminal output
- test keyboard navigation flows
- test snapshots for terminal screens
- validate Ctrl+C and exit flows

TUI testing is mandatory for:

- menus
- keyboard navigation
- prompts
- screen transitions
- command help flows
- interactive agent screens

Unit tests alone are not sufficient for TUI features.

---

## TUI Automation Architecture

All terminal automation must live under:

```text
src/testing/
  drivers/
    ink-driver.ts
    pty-driver.ts
  scenarios/
  assertions/
  snapshots/
```

### Drivers

- `ink-driver.ts` → fast render tests
- `pty-driver.ts` → real interactive terminal tests

### Required PTY methods

- `launch()`
- `type(text)`
- `enter()`
- `up()`
- `down()`
- `ctrlC()`
- `snapshot()`

### Scenario Testing

Scenario-based tests are preferred for end-to-end CLI validation.

Example scenarios:

- startup flow
- help flow
- auth flow
- command navigation
- agent execution flow

---

## React + Ink Guidelines

- use functional components
- use hooks
- keep components focused
- prefer composition
- use interfaces for props
- move shared logic into hooks
- keep UI rendering pure

---

## Code Style

- strict TypeScript always
- avoid `any`
- use `unknown` when truly required
- use strong types and interfaces
- keep functions small
- keep modules focused
- KISS
- DRY
- composable design
- follow existing patterns
- meaningful naming

Comments are only allowed for genuinely complex business logic.

---

## Constraints

- do not modify files outside project directory
- ask before breaking changes
- do not delete files without confirmation
- keep dependencies minimal
- avoid new dependencies without strong reason
- never commit secrets

---

## Regression Safety

You must never introduce regressions.

When changing behavior:

1. identify existing coverage
2. extend test coverage
3. validate related flows
4. run full proof checks

Protect existing user flows first.

---

## Git Commit Convention

Always append:

`Co-authored-by: Autohand Evolve <code-noreply@autohand.ai>`

to every commit message.

Never ever create branches with prefix like codex/ fix/
never ever create prefix like codex/ fix/ or codex/ feature/ or codex/ hotfix/.

---

## Craft Standard

Code is craft.

Write code that another senior engineer can trust immediately.

Priorities:

1. correctness
2. readability
3. testability
4. reliability
5. maintainability
