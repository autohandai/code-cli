# JSON-RPC 2.0 Protocol Reference

Autohand supports a JSON-RPC 2.0 protocol for IDE integration (VS Code, Zed, etc.). This document describes the protocol for building extensions and clients.

## Overview

Communication uses newline-delimited JSON over stdio:
- **stdin**: Client sends requests to Autohand
- **stdout**: Autohand sends responses and notifications to client
- **stderr**: Debug logs (not part of protocol)

## Protocol Basics

All messages follow JSON-RPC 2.0 specification.

### Request Format
```json
{
  "jsonrpc": "2.0",
  "method": "autohand.prompt",
  "params": { "message": "..." },
  "id": 1
}
```

### Response Format
```json
{
  "jsonrpc": "2.0",
  "result": { "success": true },
  "id": 1
}
```

### Notification Format (no id, no response expected)
```json
{
  "jsonrpc": "2.0",
  "method": "autohand.toolStart",
  "params": { "toolId": "...", "toolName": "..." }
}
```

---

## Client Methods (Client -> Server)

### `autohand.prompt`
Send a user instruction to the agent.

**Parameters:**
```typescript
{
  message: string;
  context?: {
    files?: string[];
    selection?: {
      file: string;
      startLine: number;
      endLine: number;
      text: string;
    };
  };
  images?: Array<{
    data: string;      // Base64-encoded
    mimeType: string;  // image/png, image/jpeg, image/gif, image/webp
    filename?: string;
  }>;
}
```

**Result:**
```typescript
{ success: boolean }
```

### `autohand.abort`
Abort the current operation.

**Parameters:** None

**Result:**
```typescript
{ success: boolean }
```

### `autohand.reset`
Reset the conversation context.

**Parameters:** None

**Result:**
```typescript
{ sessionId: string }
```

### `autohand.getState`
Get current agent state.

**Parameters:** None

**Result:**
```typescript
{
  status: 'idle' | 'processing' | 'waiting_permission';
  sessionId: string | null;
  model: string;
  workspace: string;
  contextPercent: number;
  messageCount: number;
}
```

### `autohand.getMessages`
Get conversation history.

**Parameters:**
```typescript
{ limit?: number }
```

**Result:**
```typescript
{
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp: string;
    toolCalls?: Array<{
      id: string;
      name: string;
      args: Record<string, unknown>;
    }>;
  }>;
}
```

### `autohand.permissionResponse`
Respond to a permission request.

**Parameters:**
```typescript
{
  requestId: string;
  allowed: boolean;
}
```

**Result:**
```typescript
{ success: boolean }
```

### `autohand.permissionAcknowledged`
Acknowledge receipt of a permission request.

**Parameters:**
```typescript
{ requestId: string }
```

**Result:**
```typescript
{ success: boolean }
```

### `autohand.changesDecision`
Accept or reject batched file changes.

**Parameters:**
```typescript
{
  batchId: string;
  action: 'accept_all' | 'reject_all' | 'accept_selected';
  selectedChangeIds?: string[];
}
```

**Result:**
```typescript
{
  success: boolean;
  appliedCount: number;
  skippedCount: number;
  errors?: Array<{ changeId: string; error: string }>;
}
```

---

## Server Notifications (Server -> Client)

### Session Lifecycle

#### `autohand.agentStart`
Session has started.

```typescript
{
  sessionId: string;
  model: string;
  workspace: string;
  timestamp: string;
  contextPercent: number;
}
```

#### `autohand.agentEnd`
Session has ended.

```typescript
{
  sessionId: string;
  reason: 'completed' | 'aborted' | 'error';
  timestamp: string;
}
```

### Turn Lifecycle

#### `autohand.turnStart`
A new instruction is being processed.

```typescript
{
  turnId: string;
  sessionId: string;
  instruction: string;
  timestamp: string;
}
```

#### `autohand.turnEnd`
Instruction processing complete.

```typescript
{
  turnId: string;
  sessionId: string;
  stats: {
    tokensUsed: number;
    duration: number;
    contextPercent: number;
  };
  timestamp: string;
}
```

### Message Streaming

#### `autohand.messageStart`
LLM response started.

```typescript
{
  messageId: string;
  turnId: string;
  timestamp: string;
}
```

#### `autohand.messageUpdate`
Streaming content update.

```typescript
{
  messageId: string;
  delta: string;
  thought?: string;
  timestamp: string;
}
```

#### `autohand.messageEnd`
LLM response complete.

```typescript
{
  messageId: string;
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
  timestamp: string;
}
```

### Tool Execution

#### `autohand.toolStart`
Tool execution started.

```typescript
{
  toolId: string;
  toolName: string;
  args: Record<string, unknown>;
  timestamp: string;
}
```

#### `autohand.toolUpdate`
Streaming tool output.

```typescript
{
  toolId: string;
  output: string;
  stream: 'stdout' | 'stderr';
  timestamp: string;
}
```

#### `autohand.toolEnd`
Tool execution complete.

```typescript
{
  toolId: string;
  toolName: string;
  success: boolean;
  output?: string;
  error?: string;
  timestamp: string;
}
```

### Permission Requests

#### `autohand.permissionRequest`
Agent needs user approval.

```typescript
{
  requestId: string;
  tool: string;
  description: string;
  context?: {
    path?: string;
    command?: string;
    args?: Record<string, unknown>;
  };
  timestamp: string;
}
```

### Errors

#### `autohand.error`
An error occurred.

```typescript
{
  code: number;
  message: string;
  recoverable: boolean;
  timestamp: string;
}
```

### File Change Preview

#### `autohand.changesBatchStart`
Preview mode activated, changes will be batched.

```typescript
{
  batchId: string;
  turnId: string;
  timestamp: string;
}
```

#### `autohand.changesBatchUpdate`
Individual file change detected.

```typescript
{
  batchId: string;
  change: {
    id: string;
    filePath: string;
    changeType: 'create' | 'modify' | 'delete';
    originalContent: string;
    proposedContent: string;
    description: string;
    toolId: string;
    toolName: string;
  };
  timestamp: string;
}
```

#### `autohand.changesBatchEnd`
All changes ready for review.

```typescript
{
  batchId: string;
  changeCount: number;
  timestamp: string;
}
```

---

## Hook Lifecycle Notifications

Hook notifications allow clients to respond to agent lifecycle events for custom integrations.

### `autohand.hook.preTool`
Fired before a tool begins execution.

```typescript
{
  toolId: string;
  toolName: string;
  args: Record<string, unknown>;
  timestamp: string;
}
```

### `autohand.hook.postTool`
Fired after a tool completes execution.

```typescript
{
  toolId: string;
  toolName: string;
  success: boolean;
  duration: number;
  output?: string;
  timestamp: string;
}
```

### `autohand.hook.fileModified`
Fired when a file is created, modified, or deleted.

```typescript
{
  filePath: string;
  changeType: 'create' | 'modify' | 'delete';
  toolId: string;
  timestamp: string;
}
```

### `autohand.hook.prePrompt`
Fired before sending a prompt to the LLM.

```typescript
{
  instruction: string;
  mentionedFiles: string[];
  timestamp: string;
}
```

### `autohand.hook.postResponse`
Fired after receiving a response from the LLM.

```typescript
{
  tokensUsed: number;
  toolCallsCount: number;
  duration: number;
  timestamp: string;
}
```

### `autohand.hook.sessionError`
Fired when an error occurs during agent execution.

```typescript
{
  error: string;
  code?: string;
  context?: Record<string, unknown>;
  timestamp: string;
}
```

---

## Error Codes

Standard JSON-RPC 2.0 error codes:

| Code | Name | Description |
|------|------|-------------|
| -32700 | Parse Error | Invalid JSON |
| -32600 | Invalid Request | Not a valid JSON-RPC request |
| -32601 | Method Not Found | Unknown method |
| -32602 | Invalid Params | Invalid method parameters |
| -32603 | Internal Error | Internal server error |

Autohand-specific error codes:

| Code | Name | Description |
|------|------|-------------|
| -32000 | Execution Error | Tool/action execution failed |
| -32001 | Permission Denied | User denied permission |
| -32002 | Timeout | Operation timed out |
| -32003 | Agent Busy | Agent is processing another request |
| -32004 | Aborted | Operation was aborted |

---

## Example Client Implementation

### Node.js

```typescript
import { spawn } from 'child_process';
import * as readline from 'readline';

const autohand = spawn('autohand', ['--rpc'], {
  stdio: ['pipe', 'pipe', 'inherit']
});

const rl = readline.createInterface({
  input: autohand.stdout,
  crlfDelay: Infinity
});

let requestId = 0;
const pendingRequests = new Map();

// Handle responses and notifications
rl.on('line', (line) => {
  const message = JSON.parse(line);

  if ('id' in message) {
    // Response to a request
    const pending = pendingRequests.get(message.id);
    if (pending) {
      pendingRequests.delete(message.id);
      if (message.error) {
        pending.reject(message.error);
      } else {
        pending.resolve(message.result);
      }
    }
  } else {
    // Notification
    handleNotification(message.method, message.params);
  }
});

function handleNotification(method: string, params: any) {
  switch (method) {
    case 'autohand.toolStart':
      console.log(`Tool started: ${params.toolName}`);
      break;
    case 'autohand.toolEnd':
      console.log(`Tool ended: ${params.toolName} (${params.success ? 'success' : 'failed'})`);
      break;
    case 'autohand.hook.fileModified':
      console.log(`File ${params.changeType}: ${params.filePath}`);
      break;
    // Handle other notifications...
  }
}

async function sendRequest(method: string, params?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    pendingRequests.set(id, { resolve, reject });

    const request = {
      jsonrpc: '2.0',
      method,
      params,
      id
    };

    autohand.stdin.write(JSON.stringify(request) + '\n');
  });
}

// Example usage
async function main() {
  const state = await sendRequest('autohand.getState');
  console.log('Agent state:', state);

  await sendRequest('autohand.prompt', {
    message: 'Create a hello world function'
  });
}

main();
```

### VS Code Extension

```typescript
import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';

export function activate(context: vscode.ExtensionContext) {
  const client = new LanguageClient(
    'autohand',
    'Autohand',
    {
      command: 'autohand',
      args: ['--rpc']
    },
    {
      documentSelector: [{ scheme: 'file' }]
    }
  );

  // Subscribe to hook notifications
  client.onNotification('autohand.hook.preTool', (params) => {
    vscode.window.setStatusBarMessage(`Running: ${params.toolName}`, 2000);
  });

  client.onNotification('autohand.hook.fileModified', (params) => {
    // Refresh file tree
    vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
  });

  client.start();
  context.subscriptions.push(client);
}
```
