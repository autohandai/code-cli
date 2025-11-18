# Autohand Multi-Agent Orchestration PRD

## Overview
Autohand currently runs a single conversational agent per session. This PRD introduces a supervisor/orchestrator pattern that can spin up to five sub-agents (threads) in parallel. Each sub-agent can pursue a specific task (e.g., “update docs”, “add tests”, “refactor module”), coordinate via shared context, and report results back to the orchestrator for a final summary—mirroring Codex/Gemini collaborative flows.

## Goals
- Allow the user (or the main agent) to create parallel workstreams when a task benefits from concurrency.
- Provide structured summaries: per-agent reports + orchestrator recap.
- Keep safety controls (confirmation, ESC cancel, undo stack) per sub-agent.
- Ensure UX remains clear: show active tasks, progress, and completion status.

## Architecture

### Orchestrator (`AgentSupervisor`)
- Accepts high-level instructions and decides whether to spawn sub-agents.
- Maintains registry of active agents (max 5, configurable).
- Aggregates agent outputs (diff results, logs, final summaries).
- Provides hooks for: start, status updates, cancellation, final summary.

### Sub-Agent (`ChildAgent`)
- Inherits core capabilities from `AutohandAgent` (filesystem tools, slash commands, etc.).
- Runs in its own async thread/promise; optionally uses worker threads/processes for isolation.
- Each child keeps its own prompt history and context meter.
- Reports status snapshots back to supervisor for display.

### Shared Context
- Workspace state (git status, file listings) should be read-only shared. Mutations must go through orchestrator so the undo stack and `delete_path` confirmations remain consistent.
- Use a central event bus (e.g., `AgentEvents`) to broadcast file changes so other agents can refresh.

## User Flow
1. User types a high-level goal.
2. Main agent decides to spawn sub-agents or user issues `/spawn` slash command specifying threads.
3. Orchestrator queues tasks, starts up to 5 sub-agents (each with its own REPL log/UI block).
4. Sub-agents execute concurrently, streaming summaries/status to Ink UI.
5. Orchestrator monitors for completion/cancelation, collects final reports.
6. Main prompt gets a synthesized summary plus optional diffs.

## UI Requirements
- Ink dashboard showing each sub-agent: status (running, waiting, done), context %, last message.
- Commands to list active agents `/agents`, cancel `/cancel <id>`, or focus on one agent’s transcript.
- Final summary component comparing agent outputs.

## Safety & Limits
- Cap at 5 agents; additional requests queue or prompt the user.
- Each sub-agent inherits confirmation policies (`--yes`, autoConfirm) but deletes/custom commands still prompt individually.
- ESC cancels the currently focused agent; double ESC stops all agents.

## Implementation Plan
1. Implement `AgentSupervisor` scaffold with spawn/kill/list logic.
2. Refactor `AutohandAgent` so it can run in child mode (namespacing logs, event callbacks).
3. Build Ink dashboard to display agent statuses in parallel.
4. Add slash commands (`/spawn`, `/agents`, `/cancel <id>`, `/focus <id>`) to manage sub-agents.
5. Integrate orchestrator with existing prompt flow—e.g., system prompt can request multi-threading or user can issue `/spawn` manually.

