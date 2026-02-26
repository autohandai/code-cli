# Teams with Agents

When you create a team, each teammate runs as a separate process using an agent definition. The agent determines the teammate's personality, capabilities, and tool access. This guide covers how to compose teams with the right mix of agents for different workflows.

---

## Agent-Team Architecture

A team consists of a lead process that coordinates one or more teammate processes. Each teammate is bound to an agent definition that controls its behavior.

```
Lead Process (TeamManager)
    |
    +-- Teammate "alice" (agent: researcher)
    |     - Has tools: read_file, search, list_tree
    |     - Can explore and analyze code
    |     - Cannot modify files
    |
    +-- Teammate "bob" (agent: tester)
    |     - Has tools: read_file, search, apply_patch, create_file, run_command
    |     - Can write tests and run them
    |
    +-- Teammate "carol" (agent: reviewer)
          - Has tools: read_file, search, search_with_context, list_tree
          - Can review code but not modify it
```

Each teammate process:

1. Starts via `autohand --mode teammate --team <name> --name <n> --agent <agent>`
2. Loads the named agent definition from the AgentRegistry
3. Uses that agent's system prompt and tool restrictions
4. Receives tasks and messages from the lead via JSON-RPC

The lead does not execute tasks directly. It creates the task list, assigns work to teammates, and monitors progress until completion.

---

## Choosing Agents for Your Team

### Read-Only vs Read-Write Agents

Some agents only have read tools -- they can analyze but not modify. Others have write tools -- they can make changes. Understanding this distinction is critical for team design.

**Read-only agents:** `researcher`, `reviewer`

These agents have access to tools like `read_file`, `search`, `search_with_context`, `list_tree`, and `list_directory`. They can explore the codebase, analyze patterns, and report findings, but they cannot create, modify, or delete files.

**Read-write agents:** `tester`, `code-cleaner`, `todo-resolver`, `docs-writer`

These agents have additional tools like `apply_patch`, `create_file`, `delete_path`, `replace_in_file`, and `run_command`. They can make concrete changes to the codebase.

Think about this when designing task dependencies:

- Read-only agents work well for research and review phases.
- Read-write agents handle implementation and cleanup.
- The `reviewer` agent deliberately lacks write access to maintain objectivity.

### Task-Agent Matching

| Task Type | Recommended Agent | Why |
|---|---|---|
| Codebase analysis | `researcher` | Has search and exploration tools |
| Find and fix TODOs | `todo-resolver` | Has search + patch + command tools |
| Write new tests | `tester` | Has file creation + command execution |
| Remove dead code | `code-cleaner` | Has delete and patch tools |
| Generate docs | `docs-writer` | Has file creation and search tools |
| Code review | `reviewer` | Read-only tools enforce review discipline |

When a task does not map cleanly to a built-in agent, create a custom agent with the exact tool set you need. See [Creating Custom Agent Teams](#creating-custom-agent-teams) below.

---

## Team Composition Examples

### Small Feature Team (3 agents)

```
researcher  -> Understand codebase context
tester      -> Write tests, verify implementation
reviewer    -> Final quality check
```

This is a good starting point for most feature work. The researcher gathers context, the tester validates behavior, and the reviewer catches issues.

### Maintenance Team (4 agents)

```
researcher     -> Scan for issues
code-cleaner   -> Remove dead code
todo-resolver  -> Implement TODOs
tester         -> Verify nothing breaks
```

Use this composition for periodic codebase hygiene. The researcher identifies problem areas, two specialized agents handle different kinds of cleanup, and the tester confirms nothing regressed.

### Documentation Team (3 agents)

```
researcher   -> Analyze architecture and APIs
docs-writer  -> Write documentation
reviewer     -> Validate accuracy
```

The researcher maps out the codebase structure and surfaces the information the docs-writer needs. The reviewer checks that the resulting documentation is accurate and complete.

### Full Feature Team (5 agents)

```
researcher     -> Phase 1: Understand requirements and codebase
tester         -> Phase 2: Write failing tests
todo-resolver  -> Phase 2: Handle any related TODOs (parallel)
docs-writer    -> Phase 3: Document the new feature
reviewer       -> Phase 4: Review everything
```

This is the most comprehensive composition. Tasks are phased so that later agents build on earlier results. Phases 2 and 3 show how agents can work in parallel when their tasks are independent.

---

## Creating Custom Agent Teams

When built-in agents do not fit your workflow, create custom agents and compose them into purpose-built teams.

### Example: API Development Team

Define three custom agents, each with a distinct role and tool set.

**API Designer** -- saved as `~/.autohand/agents/api-designer.md`:

```markdown
---
description: Designs REST API endpoints following OpenAPI patterns
tools: read_file, search, list_tree, create_file
---

You design REST APIs following OpenAPI 3.0 specifications.

## Your Role
- Analyze existing API patterns in the codebase
- Design new endpoint schemas with request/response types
- Write OpenAPI spec files for proposed endpoints
- Ensure consistency with existing naming conventions

## Output
Produce an OpenAPI YAML file for each new endpoint group.
```

**API Implementer** -- saved as `~/.autohand/agents/api-implementer.md`:

```markdown
---
description: Implements API endpoints with proper validation and error handling
tools: read_file, search, apply_patch, create_file, run_command
---

You implement API endpoints with:
- Input validation using Zod schemas
- Proper HTTP status codes
- Consistent error response format
- Middleware integration

## Boundaries
- Follow the OpenAPI spec produced by the designer
- Do not modify existing endpoint behavior
- Run the linter after every file change
```

**API Tester** -- saved as `~/.autohand/agents/api-tester.md`:

```markdown
---
description: Writes integration tests for API endpoints
tools: read_file, search, apply_patch, create_file, run_command
---

You write API integration tests that cover:
- Happy path for each endpoint
- Validation error cases
- Authentication and authorization
- Edge cases and boundary conditions

## Definition of Done
- Every endpoint has at least one test per HTTP method
- All tests pass when run with the project test runner
- No test depends on external network calls
```

Then compose the team:

```
api-designer    -> Design endpoint specs
api-implementer -> Implement from specs
api-tester      -> Write integration tests
reviewer        -> Review the implementation
```

The `reviewer` is the built-in agent -- there is no need to create a custom version unless you want to add domain-specific review criteria.

---

## Agent Communication Patterns

Teams coordinate through task dependencies and direct messages. Three common patterns emerge.

### Sequential Pipeline

Tasks flow from one agent to the next. Each task is blocked by the one before it.

```
Task 1 (researcher) -> Task 2 (tester) -> Task 3 (reviewer)
                       blockedBy: [1]      blockedBy: [2]
```

Use this when each phase requires the output of the previous phase. The tester cannot write tests until the researcher has identified what to test. The reviewer cannot review until the tester has written tests.

### Parallel Workers

Multiple agents work on independent tasks simultaneously with no dependencies between them.

```
Task 1 (code-cleaner) - file group A
Task 2 (code-cleaner) - file group B    (no dependencies)
Task 3 (code-cleaner) - file group C
```

Use this when tasks are naturally independent. Multiple instances of the same agent type can work in parallel on different parts of the codebase. This is the fastest pattern but only applies when tasks do not overlap.

### Fan-Out / Fan-In

One research phase fans out to multiple workers, then converges for review.

```
Task 1 (researcher)
    |
    +-> Task 2 (tester)        blockedBy: [1]
    +-> Task 3 (docs-writer)   blockedBy: [1]
    +-> Task 4 (code-cleaner)  blockedBy: [1]
    |
Task 5 (reviewer)              blockedBy: [2, 3, 4]
```

This is the most common pattern for feature work. The researcher establishes context once, multiple specialists work in parallel, and the reviewer validates everything at the end. Task 5 cannot start until all three worker tasks complete.

---

## Model Overrides per Agent

Different agents may benefit from different models. Simple tasks like code cleanup do not require the most capable model, while architecture review benefits from stronger reasoning.

Set the model in the agent's frontmatter:

```markdown
---
description: Quick code cleanup agent
tools: read_file, search, apply_patch
model: anthropic/claude-3-haiku
---
```

The `model` field overrides the global default from `~/.autohand/config.json` for that agent only. Other agents on the same team continue to use the global default unless they have their own override.

Guidelines for model selection:

- **Fast/cheap models** (e.g., `claude-3-haiku`) -- cleanup, search, simple formatting tasks.
- **Balanced models** (e.g., `claude-3.5-sonnet`) -- test writing, documentation, implementation.
- **Capable models** (e.g., `claude-3-opus`) -- architecture analysis, security review, complex refactoring.

Mixing models within a team lets you optimize both cost and quality across different task types.

---

## Monitoring Agent Activity

### Team Status

Use `/team status` to see what each agent is doing:

```
Team: feature-auth [active]

Tasks [2/5 done]
  [done] task-1: Research auth patterns          -> alice
  [done] task-2: Write auth middleware tests     -> bob
  [working] task-3: Implement auth middleware    -> bob
  [pending] task-4: Write documentation          (blocked by task-3)
  [pending] task-5: Review implementation        (blocked by task-3, task-4)

Teammates
  [idle] alice (researcher)
  [working] bob (tester)
  [idle] carol (reviewer)
```

The status view shows both task progress and teammate states. An idle teammate is waiting for new work or for a blocked task to become available.

### Direct Messaging

Use `/message <name> <text>` to communicate with specific agents during execution:

```
/message bob Focus on edge cases for the password validation endpoint
```

This sends a message directly to the named teammate. The agent receives it as part of its conversation and can adjust its approach accordingly.

---

## Best Practices

### 1. Principle of Least Privilege

Give agents only the tools they need. A reviewer that cannot write files enforces genuine review discipline -- it must report issues rather than silently fix them. A researcher with no write tools cannot accidentally modify the files it analyzes.

### 2. Name Teammates Descriptively

Use names that reflect the teammate's role in the current task, not generic identifiers.

```
# Good
auth-researcher
test-writer
api-reviewer

# Bad
agent1
agent2
agent3
```

Descriptive names make `/team status` output readable and help the lead route messages to the right teammate.

### 3. Model Task Dependencies Carefully

Incorrect `blockedBy` chains cause deadlocks (circular dependencies) or ordering issues (a writer starting before research completes). Before launching a team, sketch the dependency graph and verify that:

- There are no cycles.
- Every task that needs prior output is blocked by the task that produces it.
- Independent tasks have no unnecessary dependencies (they should run in parallel).

### 4. Start Small

Begin with 2-3 agents and add more as needed. Coordination overhead grows with team size. A three-agent team (researcher, implementer, reviewer) handles most workflows. Add specialists only when a distinct capability is needed.

### 5. Reuse Built-in Agents

The six built-in agents cover the most common development tasks. Create custom agents only when you need a tool combination or behavioral pattern that no built-in provides. Overriding a built-in with a domain-specific version is often better than creating an entirely new agent.

### 6. Test Agent Prompts

Run a new agent on a small, isolated task before adding it to a large team workflow. Verify that it uses the right tools, follows its prompt instructions, and produces output in the expected format. Debugging an agent in a solo run is far easier than debugging it mid-team-execution.
