import type { SessionMessage } from '../../session/types.js';
import type { ToolOutputChunk } from '../../types.js';

export interface AgentToolOutputRuntimeHost {
  sessionManager: {
    getCurrentSession(): {
      append(message: SessionMessage): Promise<void>;
      appendTransient(message: SessionMessage): Promise<void>;
    } | null;
  };
  toolOutputQueue: Promise<void>;
  queueToolMessageChunk(
    name: string,
    content: string,
    toolCallId: string,
    stream?: 'stdout' | 'stderr'
  ): void;
}

export function handleAgentToolOutput(
  host: AgentToolOutputRuntimeHost,
  chunk: ToolOutputChunk
): void {
  if (process.env.AUTOHAND_STREAM_TOOL_OUTPUT !== '1') {
    return;
  }
  if (!chunk.toolCallId || !chunk.data) {
    return;
  }
  host.queueToolMessageChunk(chunk.tool, chunk.data, chunk.toolCallId, chunk.stream);
}

export function queueAgentToolMessageChunk(
  host: AgentToolOutputRuntimeHost,
  name: string,
  content: string,
  toolCallId: string,
  stream?: 'stdout' | 'stderr'
): void {
  const session = host.sessionManager.getCurrentSession();
  if (!session) return;

  const message: SessionMessage = {
    role: 'tool',
    content,
    name,
    timestamp: new Date().toISOString(),
    tool_call_id: toolCallId,
    _meta: stream ? { stream } : undefined,
  };

  host.toolOutputQueue = host.toolOutputQueue
    .catch(() => undefined)
    .then(() => session.appendTransient(message));
}

export async function saveAgentToolMessage(
  host: AgentToolOutputRuntimeHost,
  name: string,
  content: string,
  toolCallId?: string
): Promise<void> {
  const session = host.sessionManager.getCurrentSession();
  if (!session) return;

  await host.toolOutputQueue.catch(() => undefined);

  const message: SessionMessage = {
    role: 'tool',
    content,
    name,
    timestamp: new Date().toISOString(),
    tool_call_id: toolCallId,
  };
  await session.append(message);
}
