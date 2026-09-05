import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpClientManager, McpStdioConnection } from '../../src/mcp/McpClientManager.js';
import type { McpServerConfig } from '../../src/mcp/types.js';

const config: McpServerConfig = { name: 'Notion', transport: 'stdio', command: 'npx', args: ['-y', 'mcp-remote@0.8.3', 'https://mcp.notion.com/mcp', '--auth-timeout', '180'] };

describe('OAuth MCP bridge startup', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('keeps initialization pending while a user authorizes in the browser', async () => {
    vi.useFakeTimers();
    const connection = new McpStdioConnection(config, 'newline');
    const writes: string[] = [];
    const child = { stdin: { writable: true, write: (data: string) => writes.push(data) } };
    (connection as unknown as { process: typeof child }).process = child;
    let failure: unknown;
    const initialized = connection.request('initialize', {}).catch((error: unknown) => { failure = error; });
    await vi.advanceTimersByTimeAsync(45000);
    expect(failure).toBeUndefined();
    const request = JSON.parse(writes[0]) as { id: number };
    (connection as unknown as { handleStdoutData: (data: Buffer) => void }).handleStdoutData(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { capabilities: { tools: {} } } }) + '\n'));
    await initialized;
    expect(failure).toBeUndefined();
  });

  it('uses newline framing immediately for the OAuth bridge', async () => {
    const manager = new McpClientManager();
    const connect = vi.spyOn(manager as unknown as { connectStdioWithFraming: (config: McpServerConfig, framing: string, generation: number) => Promise<unknown> }, 'connectStdioWithFraming').mockResolvedValue({});
    await (manager as unknown as { connectStdioWithFallbackFraming: (config: McpServerConfig, generation: number) => Promise<unknown> }).connectStdioWithFallbackFraming(config, 0);
    expect(connect).toHaveBeenCalledWith(config, 'newline', 0);
    expect(connect).toHaveBeenCalledOnce();
  });
});
