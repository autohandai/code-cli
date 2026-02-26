# Combining Teams with Skills

## Overview

Skills are reusable prompt templates that define structured workflows such as brainstorming, test-driven development, code review, and documentation generation. When combined with Autohand's teams feature, skills can orchestrate multi-agent workflows where each teammate follows a specific skill-driven process.

This guide covers workflow patterns, agent configuration, hook integration, and best practices for building effective skill-driven teams.

## How Skills and Teams Work Together

Skills and teams complement each other at different levels of the system:

- The **lead process** uses skills to plan work, decompose features into tasks, and coordinate execution across teammates.
- **Teammates** can be configured with agent definitions that embed skill-like methodologies directly into their system prompts, ensuring consistent behavior.
- **Hook events** from the team lifecycle can trigger skill-related automation, such as running linters after task completion or executing the full test suite when a team shuts down.

The combination creates a pipeline: skills define *how* work should be done, teams define *who* does it, and hooks define *what happens* at key lifecycle points.

## Workflow Patterns

### Pattern 1: Skill-Driven Task Decomposition

Use a planning skill to break work into structured tasks, then distribute those tasks to a team of specialized agents.

**Steps:**

1. The lead uses the `writing-plans` skill to create a detailed implementation plan.
2. The lead creates a team and populates the task list from the plan output.
3. Each task is assigned to an appropriate agent type (researcher, tester, code-writer, reviewer).
4. Teammates execute tasks in parallel where possible, respecting dependency order for sequential work.

**Example workflow:**

```
Lead: /team create feature-auth
Lead: (uses writing-plans skill to generate tasks)
  -> Task 1: Research existing auth patterns (researcher)
  -> Task 2: Write failing tests (tester, blocked by Task 1)
  -> Task 3: Implement auth middleware (code-writer, blocked by Task 2)
  -> Task 4: Review implementation (reviewer, blocked by Task 3)
Lead: Teammates are auto-assigned as tasks become unblocked
```

In this pattern, the planning skill ensures thorough task decomposition, while the team infrastructure handles parallel execution and dependency management.

### Pattern 2: TDD with Teams

Combine test-driven development methodology with specialized agents to enforce strict TDD discipline across a team.

**Agent roles:**

- **tester** agent writes failing tests based on requirements.
- **code-writer** agent implements the minimal code to make tests pass.
- **reviewer** agent reviews the final implementation for correctness and quality.

**Dependency chain:**

```
write-tests (tester) -> implement (code-writer) -> review (reviewer)
```

The task dependency chain enforces proper TDD order. The code-writer cannot begin until the tester has completed the failing tests. The reviewer cannot begin until the code-writer has a passing implementation.

This pattern prevents the common anti-pattern of writing tests after implementation, because the dependency system makes it structurally impossible.

### Pattern 3: Research and Document

Use a team for codebase analysis followed by documentation generation.

**Agent roles:**

- **researcher** agent analyzes codebase patterns, architecture, and interfaces.
- **docs-writer** agent generates documentation based on the researcher's findings.
- **reviewer** agent validates documentation accuracy against the actual codebase.

This pattern works well for onboarding documentation, API references, and architecture decision records. The researcher provides structured findings that the docs-writer can transform into polished documentation without needing to re-analyze the codebase.

### Pattern 4: Code Cleanup Sprint

Automated codebase maintenance using multiple specialized agents working in parallel where possible.

**Agent roles:**

- **researcher** scans for issues using ProjectProfiler signals (dead code, missing tests, unresolved TODOs).
- **code-cleaner** removes dead code, unused imports, and deprecated patterns.
- **todo-resolver** implements TODO and FIXME items identified during the scan.
- **tester** ensures that cleanup changes do not break existing tests.

**Dependency structure:**

```
research (researcher)
  -> clean-dead-code (code-cleaner, blocked by research)
  -> resolve-todos (todo-resolver, blocked by research)
  -> verify-tests (tester, blocked by clean-dead-code AND resolve-todos)
```

The cleanup and TODO resolution can run in parallel after research completes, but test verification waits for both to finish.

## Creating Skill-Aware Agents

Agent definitions are markdown files stored in `.autohand/agents/` (project-level) or `~/.autohand/agents/` (global). You can create agents whose system prompts incorporate specific skill methodologies.

### Example: TDD Agent

```markdown
---
description: TDD agent that writes tests first, then implementation
tools: read_file, search, apply_patch, create_file, run_command
---

You follow strict Test-Driven Development:

## Process
1. Read the task requirements carefully
2. Write a failing test that captures the expected behavior
3. Run the test to confirm it fails
4. Write the minimal implementation to make the test pass
5. Run the test to confirm it passes
6. Refactor if needed, keeping tests green
7. Commit with a descriptive message

## Rules
- NEVER write implementation before the test
- Each test should test ONE behavior
- Keep implementations minimal - only what the test requires
- Run tests after every change
```

### Example: Documentation Agent

```markdown
---
description: Documentation writer that produces clear, accurate docs
tools: read_file, search, create_file, apply_patch
---

You write technical documentation based on codebase analysis.

## Process
1. Read the source files referenced in the task
2. Identify public APIs, configuration options, and usage patterns
3. Write documentation with clear headings, code examples, and parameter descriptions
4. Cross-reference with existing documentation to maintain consistency
5. Flag any undocumented behavior or ambiguities for the reviewer

## Rules
- Every public function or method must have a usage example
- Use consistent terminology across all documentation
- Include both simple and advanced usage examples where appropriate
- Do not fabricate behavior - only document what the code actually does
```

### Example: Code Reviewer Agent

```markdown
---
description: Code reviewer focused on correctness, security, and maintainability
tools: read_file, search
---

You review code changes for quality, correctness, and security.

## Process
1. Read the changed files and understand the intent of the changes
2. Check for correctness: does the code do what it claims?
3. Check for security: are there injection risks, auth bypasses, or data leaks?
4. Check for maintainability: is the code clear, well-named, and properly structured?
5. Report findings as a structured list with severity levels

## Rules
- Distinguish between blocking issues and suggestions
- Provide specific line references for each finding
- Suggest concrete fixes, not just problem descriptions
- Acknowledge good patterns as well as problems
```

## Using Hooks with Team Skills

Hook events let you trigger skill-related automation at key points in the team lifecycle. Hooks are configured in your project's `.autohand/settings.json` or the global `~/.autohand/settings.json`.

### Task Completion Hook

Run validation after each task is marked complete:

```json
{
  "hooks": {
    "enabled": true,
    "hooks": [
      {
        "event": "task-completed",
        "command": "echo 'Task completed, running lint check' && npm run lint",
        "description": "Run linter after each task completion"
      }
    ]
  }
}
```

### Team Shutdown Hook

Run the full test suite when the team finishes all work:

```json
{
  "hooks": {
    "enabled": true,
    "hooks": [
      {
        "event": "team-shutdown",
        "command": "npm test && echo 'All tests pass after team work'",
        "description": "Run full test suite when team finishes"
      }
    ]
  }
}
```

### Combined Hook Configuration

A practical configuration combining multiple lifecycle hooks:

```json
{
  "hooks": {
    "enabled": true,
    "hooks": [
      {
        "event": "task-completed",
        "command": "npm run lint",
        "description": "Lint after each task"
      },
      {
        "event": "task-completed",
        "command": "npm run typecheck",
        "description": "Type-check after each task"
      },
      {
        "event": "team-shutdown",
        "command": "npm test",
        "description": "Full test suite on team shutdown"
      }
    ]
  }
}
```

## Project Profiler as Skill Input

The ProjectProfiler analyzes a codebase and generates signals that indicate areas needing attention. These signals can directly inform skill-driven task creation.

### Signal-to-Agent Mapping

| Profiler Signal    | Agent Type       | Action                                      |
| ------------------ | ---------------- | ------------------------------------------- |
| TODO signals       | `todo-resolver`  | Resolve each TODO cluster by file or module |
| missing-docs       | `docs-writer`    | Generate documentation for undocumented code |
| missing-tests      | `tester`         | Write tests to improve coverage             |
| dead-code          | `code-cleaner`   | Remove unused exports and unreachable code  |
| deprecated-usage   | `code-writer`    | Migrate deprecated API calls                |

### Example: Profiler-Driven Team Creation

```
1. ProjectProfiler.analyze() finds:
   - 15 TODOs across 8 files (high severity)
   - No docs/ directory (medium severity)
   - No tests/ directory (medium severity)

2. Lead creates team with:
   - todo-resolver assigned TODO tasks (grouped by file)
   - docs-writer assigned documentation tasks
   - tester assigned test creation tasks
```

This approach ensures that team work is driven by actual codebase needs rather than guesswork. The profiler provides objective data, and the lead translates that data into concrete tasks for the right specialists.

## Multi-Phase Workflows

Complex features often require multiple sequential phases, each with its own team composition. Phases ensure that work flows in the correct order and that each phase builds on the output of the previous one.

### Phase 1: Research

```
Team: research-phase
  researcher -> analyze codebase, identify patterns
  researcher -> document dependencies and interfaces
```

Output: structured findings document listing patterns, interfaces, and constraints.

### Phase 2: Implementation

```
Team: impl-phase
  tester -> write failing tests from research findings
  code-writer -> implement features to pass tests
```

Output: tested, working implementation that satisfies the requirements identified in Phase 1.

### Phase 3: Quality

```
Team: quality-phase
  reviewer -> review all changes
  docs-writer -> update documentation
  code-cleaner -> clean up any dead code introduced
```

Output: reviewed, documented, clean codebase ready for merge.

### Phase Transitions

Each phase completes before the next begins. The lead is responsible for:

1. Shutting down the current team after all tasks are complete.
2. Reviewing the phase output for quality.
3. Creating the next team with tasks derived from the previous phase's output.

This approach prevents wasted work from later phases building on incomplete or incorrect earlier work.

## Best Practices

### 1. Match Agents to Tasks

Use the right specialist for each job. A `code-cleaner` should not write documentation, and a `docs-writer` should not resolve complex TODO items. Agent specialization leads to higher quality output because each agent's system prompt is optimized for its specific role.

### 2. Use Task Dependencies

Model the natural workflow order with explicit task dependencies. Tests should be written before implementation. Research should complete before coding begins. Dependencies prevent agents from starting work before their prerequisites are met.

```
Task 1: Research auth patterns (no dependencies)
Task 2: Write auth tests (blocked by Task 1)
Task 3: Implement auth (blocked by Task 2)
Task 4: Review auth (blocked by Task 3)
```

### 3. Keep Teams Focused

Create separate teams for separate concerns rather than one large team handling everything. A team focused on authentication and a separate team focused on database migrations will produce better results than a single team juggling both.

### 4. Leverage Built-In Agents

Start with the six built-in agent types (researcher, tester, code-writer, code-cleaner, docs-writer, reviewer) before creating custom agents. The built-in agents cover the most common workflows. Create custom agents only when your use case genuinely requires specialized behavior that the defaults do not provide.

### 5. Monitor via Hooks

Use team hook events to run automated validation at key lifecycle points. Linting after each task completion catches issues early. Running the full test suite on team shutdown provides a final safety net before the work is considered complete.

### 6. Limit Team Size

More teammates means more coordination overhead. Communication complexity grows quadratically with team size. In practice, 3 to 5 teammates per team is usually optimal. If a workflow requires more agents, consider splitting the work into multiple phases with smaller teams.

### 7. Group Related Tasks

When creating tasks from profiler signals or skill output, group related items together. Assign all TODOs in a single module to one task rather than creating a separate task for each TODO. This reduces context-switching overhead for the assigned agent.

### 8. Review Phase Outputs

Before transitioning between phases in a multi-phase workflow, review the output of the completed phase. Catching issues between phases is far cheaper than discovering them at the end of the entire workflow.
