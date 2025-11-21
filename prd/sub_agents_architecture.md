# Sub-Agents Architecture & Implementation Plan

## 1. Overview
This document outlines the architecture for adding multi-agent capabilities to the Autohand CLI. The goal is to allow the main agent to delegate tasks to specialized "sub-agents" that run in parallel (up to 5). These sub-agents are defined in a user-specific directory (`~/.autohand-cli/agents/`) and can be managed via the CLI.

## 2. User Stories
- **As a user**, I want to define custom agents with specific system prompts and toolsets.
- **As a user**, I want to list all available agents using `/agents`.
- **As a user**, I want the main agent to be able to spawn multiple sub-agents to perform tasks in parallel (e.g., "Research X while writing code for Y").
- **As a user**, I want to limit the concurrency to 5 sub-agents to prevent resource exhaustion.

## 3. Architecture Components

### 3.1. Agent Definition
Agents will be defined as JSON or Markdown files in `~/.autohand-cli/agents/`.
Each definition will contain:
- `name`: Unique identifier (filename).
- `description`: Short description for the main agent to understand when to use it.
- `systemPrompt`: The specific instructions/persona for this agent.
- `tools`: A list of tool names (subset of available tools) this agent is allowed to use.
- `model`: (Optional) Specific model override for this agent.

**Example `~/.autohand-cli/agents/researcher.json`:**
```json
{
  "description": "Expert at searching the codebase and documentation to answer questions.",
  "systemPrompt": "You are a research assistant. Your goal is to find information...",
  "tools": ["search_codebase", "read_file", "search_web"]
}
```

### 3.2. Agent Registry (`AgentRegistry`)
A singleton service responsible for:
- Scanning `~/.autohand-cli/agents/` on startup.
- Validating and loading agent configurations.
- Providing a list of available agents.

### 3.3. Sub-Agent Execution (`SubAgentExecutor`)
A class responsible for instantiating and running a sub-agent session.
- It will reuse the existing `Agent` class logic but with a scoped context and toolset.
- It needs to handle its own message history and context window.
- It must return a final result string to the main agent.

### 3.4. New Tools for Main Agent
The main agent (acting as the "Lead Agent") needs tools to interact with this system. It can choose to run agents sequentially (chaining outputs) or in parallel (aggregating results).

1.  `list_available_agents()`: Returns metadata of all agents.
2.  `delegate_task(agent_name: string, task: string)`: Runs a single agent **synchronously**. The main agent waits for the result before proceeding. This enables sequential workflows where the output of Agent A is needed for Agent B.
3.  `delegate_parallel(tasks: Array<{agent_name: string, task: string}>)`: Runs multiple agents in **parallel** and returns aggregated results. **Enforces the 5-agent limit.** Use this for independent tasks (e.g., researching two different topics).

### 3.5. Orchestration Patterns
The Main Agent acts as the orchestrator (Lead Researcher), capable of:
- **Sequential Chaining**: Run Agent A -> Get Result -> Refine -> Run Agent B.
- **Fan-Out/Fan-In**: Run Agent A & B in parallel -> Aggregate Results -> Run Agent C to synthesize.
- **Iterative Loops**: Run an agent, evaluate the result, and decide whether to run it again or try a different agent.

### 3.6. Slash Command (`/agents`)
- Lists all agents found in the registry.
- Shows name, description, path, and tools/model when provided.

### 3.7. Seed Agents (Markdown)
Stored under `~/.autohand-cli/agents/`:
- `tester.md` — QA Tester: plans/regresses tests, reports issues with repro steps.
- `software-engineer.md` — builds features/fixes with code + tests.
- `principal-engineer.md` — sets direction, plans sequencing, reviews risk.
- `architect-web-mobile-desktop.md` — cross-platform app architecture and UX patterns.
- `devops-database-engineer.md` — pipelines, infra, migrations, observability, safety rails.

## 4. Implementation Steps

### Phase 1: Foundation
1.  Create `src/core/AgentRegistry.ts` to manage agent definitions.
2.  Define the `AgentConfig` interface.
3.  Implement loading logic from `~/.autohand-cli/agents/`.

### Phase 2: The Sub-Agent
1.  Refactor existing `Agent` class if necessary to allow "lightweight" instances or create a `SubAgent` class.
2.  Ensure `SubAgent` can reuse the existing tool implementations but with restricted access.

### Phase 3: Tools & Integration
1.  Implement `DelegateTaskTool` and `DelegateParallelTool`.
2.  Register these tools with the main `Agent`.
3.  Update the main system prompt to make the agent aware of its ability to delegate.

### Phase 4: UI & CLI
1.  Implement `/agents` slash command.
2.  Add visual indicators when sub-agents are running (e.g., "🤖 SWE is working...").

## 5. Constraints & Safety
- **Concurrency Limit**: Hard limit of 5 parallel agents.
- **Recursion**: Sub-agents should NOT be able to spawn more sub-agents (depth 1) to prevent infinite loops.
- **Context**: Sub-agents start with a fresh context containing only the delegated task. They do not inherit the full main chat history to save tokens, unless explicitly passed.
- **Tools**: Sub-agents are restricted to the tools defined in their config.

## 6. Future Extensions
- Dynamic agent creation via CLI.
- Shared memory/context between agents.
