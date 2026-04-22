# Shell Tool Analysis: Autohand vs cc-src

## Problem Statement

The `shell` tool in Autohand is **blocking the LLM flow** and not running in isolation with live updates. Long-running processes cause the agent to get "stuck" waiting for completion.

## Root Cause

### Autohand's Current Implementation (Blocking)

**File: `src/core/actionExecutor.ts:838-880`**

```typescript
case 'shell': {
  const cmdStr = `${action.command} ${(action.args ?? []).join(' ')}`.trim();
  const commandId = this.onLiveCommandStart?.(cmdStr);
  const hasLiveDisplay = Boolean(commandId);

  if (hasLiveDisplay) {
    // BLOCKING: Waits for Promise to resolve
    const result = await executeStreamingShellCommand(
      cmdStr,
      this.runtime.workspaceRoot,
      {
        onStdout: (chunk) => this.onLiveCommandOutput!(liveId, 'stdout', chunk),
        onStderr: (chunk) => this.onLiveCommandOutput!(liveId, 'stderr', chunk),
        preferPty: process.stdin.isTTY && process.stdout.isTTY,
      }
    );
    // Agent cannot continue until this resolves!
    this.onLiveCommandRemove!(liveId);
    return parts.join('\n');
  }
}
```

**Key Issues:**
1. **Synchronous from agent's perspective** - The `await` blocks the agent loop
2. **No background execution** - Cannot spawn and continue
3. **No task notification system** - Results must be returned immediately
4. **No auto-backgrounding** - Long-running commands block indefinitely

---

## How cc-src Solves This (Non-Blocking)

### Architecture Overview

cc-src uses a **task-based architecture** with these key components:

1. **ShellCommand** (`utils/ShellCommand.ts`) - Manages child process lifecycle
2. **LocalShellTask** (`tasks/LocalShellTask/LocalShellTask.tsx`) - Task orchestration
3. **Message Queue** (`utils/messageQueueManager.ts`) - Async notifications to LLM
4. **TaskHandle** - Returns immediately, process continues in background

### Key Pattern: Non-Blocking Return

**File: `cc-src/tools/BashTool/BashTool.tsx:900-1074`**

```typescript
// Start the command execution
const resultPromise = shellCommand.result;

// Wait for initial threshold (e.g., 2 seconds)
const initialResult = await Promise.race([
  resultPromise,
  new Promise<null>(resolve => {
    const t = setTimeout(resolve, PROGRESS_THRESHOLD_MS);
    t.unref(); // Don't block process exit
  })
]);

// If command completes quickly, return result immediately
if (initialResult !== null) {
  shellCommand.cleanup();
  return initialResult;
}

// Command is taking too long - background it!
const foregroundTaskId = registerForeground({
  command,
  description,
  shellCommand,
  toolUseId,
  agentId
});

// Set up timeout handler for auto-backgrounding
shellCommand.onTimeout((backgroundFn) => {
  const taskId = backgroundFn(foregroundTaskId);
  // Return immediately with background task ID
  return {
    stdout: '',
    stderr: '',
    code: 0,
    interrupted: false,
    backgroundTaskId: taskId,
    backgroundedByUser: false  // Auto-backgrounded
  };
});

// Continue waiting with progress UI...
```

### Key Pattern: Background Method

**File: `cc-src/utils/ShellCommand.ts:349-368`**

```typescript
background(taskId: string): boolean {
  if (this.#status === 'running') {
    this.#backgroundTaskId = taskId
    this.#status = 'backgrounded'
    this.#cleanupListeners()  // Remove event listeners
    
    if (this.taskOutput.stdoutToFile) {
      // File mode: child writes directly to file
      this.#startSizeWatchdog()  // Prevent disk fill
    } else {
      // Pipe mode: spill buffer to disk
      this.taskOutput.spillToDisk()
    }
    return true
  }
  return false
}
```

### Key Pattern: Task Notification

**File: `cc-src/tasks/LocalShellTask/LocalShellTask.tsx:105-180`**

```typescript
function enqueueShellNotification(
  taskId: string,
  description: string,
  status: 'completed' | 'failed' | 'killed',
  exitCode: number | undefined,
  setAppState: SetAppState,
  toolUseId?: string,
  kind: BashTaskKind = 'bash',
  agentId?: AgentId
): void {
  // Build XML notification message
  const message = `<${TASK_NOTIFICATION_TAG}>
  <${TASK_ID_TAG}>${taskId}</${TASK_ID_TAG}>
  <${STATUS_TAG}>${status}</${STATUS_TAG}>
  <${SUMMARY_TAG}>${description} exited with code ${exitCode}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>`;

  // Enqueue for LLM to process later
  enqueuePendingNotification({
    value: message,
    mode: 'task-notification',
    priority: kind === 'monitor' ? 'next' : 'later',
    agentId
  });
}

// Called when process exits
void shellCommand.result.then(async result => {
  await flushAndCleanup(shellCommand);
  enqueueShellNotification(taskId, description, status, result.code, ...);
});
```

### Key Pattern: Immediate Return with TaskHandle

**File: `cc-src/tasks/LocalShellTask/LocalShellTask.tsx:246-250`**

```typescript
// Return immediately - don't wait for process to complete!
return {
  taskId,
  cleanup: () => {
    unregisterCleanup();
  }
};
```

---

## Comparison Table

| Feature | Autohand | cc-src |
|---------|----------|--------|
| **Execution Model** | Blocking `await` | Non-blocking task system |
| **Long-running Commands** | Block agent indefinitely | Auto-background after timeout |
| **Background Support** | Only `run_command` tool | All shell commands |
| **Live Output** | Yes (but blocks) | Yes (non-blocking) |
| **Task Notifications** | No | Yes (via message queue) |
| **Process Isolation** | No | Yes (task-based) |
| **Return Type** | String result | TaskHandle + async notification |
| **Agent Can Continue** | No (blocked) | Yes (immediate return) |

---

## Solution Architecture for Autohand

### Phase 1: Add Background Parameter (Quick Fix)

Add `background: boolean` parameter to `shell` tool, similar to `run_command`.

**Files to modify:**
- `src/core/toolManager.ts` - Add parameter definition
- `src/core/actionExecutor.ts` - Handle background execution
- `src/ui/shellCommand.ts` - Support background mode

### Phase 2: Task-Based Architecture (Proper Fix)

Implement a task system similar to cc-src:

1. **Create `TaskManager`** - Manage background tasks
2. **Create `ShellTask`** - Encapsulate shell execution
3. **Create `TaskNotification`** - Async result delivery
4. **Modify `actionExecutor`** - Return TaskHandle instead of blocking
5. **Modify `agent.ts`** - Process task notifications

### Phase 3: Auto-Backgrounding

Add timeout-based auto-backgrounding:
- Wait 2-5 seconds for quick commands
- Auto-background if still running
- Return background task ID to LLM
- Send notification when complete

---

## Implementation Priority

1. **High Priority**: Add `background` parameter (unblocks dev servers, long tests)
2. **Medium Priority**: Implement task notification system
3. **Low Priority**: Auto-backgrounding with timeout

---

## Code References

### cc-src Key Files

- `/Users/igorcosta/downloads/cc-src/utils/ShellCommand.ts` - Process management
- `/Users/igorcosta/downloads/cc-src/tasks/LocalShellTask/LocalShellTask.tsx` - Task orchestration
- `/Users/igorcosta/downloads/cc-src/tools/BashTool/BashTool.tsx` - Tool implementation
- `/Users/igorcosta/downloads/cc-src/utils/messageQueueManager.ts` - Async notifications

### Autohand Key Files

- `src/core/actionExecutor.ts:838-880` - Shell tool handler (blocking)
- `src/ui/shellCommand.ts:594-640` - Streaming execution
- `src/ui/ink/InkRenderer.tsx:453-492` - Live command display
- `src/core/toolManager.ts:304-320` - Tool definition