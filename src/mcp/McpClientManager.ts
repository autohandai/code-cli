/**
 * MCP Client Manager
 *
 * Manages connections to MCP (Model Context Protocol) servers.
 * Supports stdio transport (spawned child processes communicating
 * via JSON-RPC 2.0 over stdin/stdout) and SSE transport (HTTP).
 *
 * Uses a minimal JSON-RPC 2.0 implementation for MCP communication
 * without external SDK dependencies. The MCP protocol requires:
 * 1. Initialize handshake (initialize request -> initialized notification)
 * 2. Tool discovery (tools/list)
 * 3. Tool execution (tools/call)
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  type McpServerConfig,
  type McpToolDefinition,
  type McpServerState,
  type McpServerStatus,
  type McpRawTool,
  validateMcpServerConfig,
  convertMcpToolToAutohand,
} from './types.js';
import {
  normalizeMcpCommandForSpawn,
  isNpxCommand,
  isRetriableNpxInstallError,
  buildNpxIsolatedCacheEnv,
} from './commandNormalization.js';

// ============================================================================
// JSON-RPC 2.0 Types (MCP protocol wire format)
// ============================================================================

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface McpRequestOptions {
  signal?: AbortSignal;
}

export class McpRequestAbortedError extends Error {
  constructor(message = 'MCP request aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

class McpConnectionCancelledError extends Error {
  constructor() {
    super('MCP connection cancelled during shutdown');
    this.name = 'AbortError';
  }
}

const MCP_STOP_GRACE_MS = 1_000;
const MCP_STOP_FORCE_WAIT_MS = 1_000;

function waitForChildClose(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (closed: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.off('close', onClose);
      resolve(closed);
    };
    const onClose = (): void => finish(true);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    timeout.unref?.();
    child.once('close', onClose);
  });
}

// ============================================================================
// MCP Stdio Connection
// ============================================================================

/** Manages a single stdio connection to an MCP server process */
export class McpStdioConnection extends EventEmitter {
  private process: ChildProcess | null = null;
  private lineBuffer = '';
  private frameBuffer = Buffer.alloc(0);
  private nextId = 1;
  private pendingRequests = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      removeAbortListener?: () => void;
    }
  >();
  private stopPromise: Promise<void> | null = null;

  /** Default timeout for RPC requests in milliseconds */
  private static readonly REQUEST_TIMEOUT_MS = 30_000;

  constructor(
    private readonly config: McpServerConfig,
    private readonly framing: 'content-length' | 'newline'
  ) {
    super();
  }

  /**
   * Spawns the server process and sets up communication channels.
   */
  async start(): Promise<void> {
    if (!this.config.command) {
      throw new Error(`Cannot start stdio connection: no command specified for server "${this.config.name}"`);
    }

    return new Promise<void>((resolve, reject) => {
      try {
        const normalized = normalizeMcpCommandForSpawn(this.config.command!, this.config.args);
        this.process = spawn(normalized.command, normalized.args ?? [], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            ...this.config.env,
          },
        });

        this.process.stdout?.on('data', (data: Buffer) => {
          this.handleStdoutData(data);
        });

        this.process.stderr?.on('data', (data: Buffer) => {
          this.emit('stderr', data.toString());
        });

        this.process.on('error', (err) => {
          this.emit('error', err);
          reject(err);
        });

        this.process.on('close', (code) => {
          this.cleanup();
          this.emit('close', code);
        });

        // Give the process a moment to start, then resolve
        // The actual readiness is determined by the initialize handshake
        setTimeout(() => resolve(), 100);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Sends a JSON-RPC 2.0 request and waits for the response.
   */
  async request(
    method: string,
    params?: Record<string, unknown>,
    options: McpRequestOptions = {},
  ): Promise<unknown> {
    if (options.signal?.aborted) {
      throw new McpRequestAbortedError();
    }
    if (!this.process?.stdin?.writable) {
      throw new Error(`MCP server "${this.config.name}" is not connected`);
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };

    return new Promise<unknown>((resolve, reject) => {
      const failRequest = (error: Error): void => {
        const pending = this.pendingRequests.get(id);
        if (!pending) return;
        this.pendingRequests.delete(id);
        clearTimeout(pending.timer);
        pending.removeAbortListener?.();
        pending.reject(error);
      };

      const timer = setTimeout(() => {
        failRequest(new Error(
          `MCP request "${method}" timed out after ${McpStdioConnection.REQUEST_TIMEOUT_MS}ms`
        ));
      }, McpStdioConnection.REQUEST_TIMEOUT_MS);
      timer.unref?.();

      const handleAbort = (): void => {
        if (!this.pendingRequests.has(id)) return;
        failRequest(new McpRequestAbortedError());
        try {
          this.notify('notifications/cancelled', {
            requestId: id,
            reason: 'Request aborted by client',
          });
        } catch {
          // The local request is already cancelled; notification is best-effort.
        }
      };

      const removeAbortListener = options.signal
        ? () => options.signal?.removeEventListener('abort', handleAbort)
        : undefined;
      options.signal?.addEventListener('abort', handleAbort, { once: true });

      this.pendingRequests.set(id, { resolve, reject, timer, removeAbortListener });

      const message = this.serializeMessage(request);
      try {
        this.process!.stdin!.write(message, (error) => {
          if (error) failRequest(error);
        });
      } catch (error) {
        failRequest(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Sends a JSON-RPC 2.0 notification (no response expected).
   */
  notify(method: string, params?: Record<string, unknown>): void {
    if (!this.process?.stdin?.writable) {
      return;
    }

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params !== undefined ? { params } : {}),
    };

    const message = this.serializeMessage(notification);
    this.process.stdin.write(message);
  }

  /**
   * Stops the server process and cleans up resources.
   */
  async stop(): Promise<void> {
    this.stopPromise ??= this.performStop();
    return this.stopPromise;
  }

  private async performStop(): Promise<void> {
    const child = this.process;
    if (child) {
      const gracefulClose = waitForChildClose(child, MCP_STOP_GRACE_MS);
      try {
        child.stdin?.end();
      } catch {
        // A concurrently closing stream may already be destroyed.
      }
      try {
        child.kill('SIGTERM');
      } catch {
        // The process may have exited between capture and signal.
      }

      const closedGracefully = await gracefulClose;
      if (!closedGracefully) {
        const forcedClose = waitForChildClose(child, MCP_STOP_FORCE_WAIT_MS);
        try {
          child.kill('SIGKILL');
        } catch {
          // Best-effort hard kill; cleanup below still settles pending calls.
        }
        await forcedClose;
      }
    }

    this.cleanup();
  }

  /**
   * Parses incoming stdout data as newline-delimited JSON-RPC messages.
   */
  private handleStdoutData(data: Buffer): void {
    if (this.framing === 'newline') {
      this.parseLineDelimitedData(data);
      return;
    }

    this.parseContentLengthData(data);
  }

  /**
   * Routes incoming JSON-RPC responses to their pending request handlers.
   */
  private handleMessage(message: JsonRpcResponse): void {
    if (message.id !== undefined && this.pendingRequests.has(message.id)) {
      const pending = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);
      clearTimeout(pending.timer);
      pending.removeAbortListener?.();

      if (message.error) {
        pending.reject(
          new Error(`MCP error (${message.error.code}): ${message.error.message}`)
        );
      } else {
        pending.resolve(message.result);
      }
    } else if (message.id === undefined) {
      // Server-initiated notification or unmatched response
      this.emit('notification', message);
    }
  }

  /**
   * Cleans up all pending requests and resets state.
   */
  private cleanup(): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.removeAbortListener?.();
      pending.reject(new Error('MCP connection closed'));
      this.pendingRequests.delete(id);
    }
    this.process = null;
    this.lineBuffer = '';
    this.frameBuffer = Buffer.alloc(0);
  }

  /**
   * Serializes JSON-RPC payload according to configured stdio framing mode.
   */
  private serializeMessage(payload: JsonRpcRequest | JsonRpcNotification): string {
    const json = JSON.stringify(payload);
    if (this.framing === 'newline') {
      return `${json}\n`;
    }

    const contentLength = Buffer.byteLength(json, 'utf8');
    return `Content-Length: ${contentLength}\r\n\r\n${json}`;
  }

  /**
   * Parses newline-delimited JSON-RPC messages (legacy mode).
   */
  private parseLineDelimitedData(data: Buffer): void {
    this.lineBuffer += data.toString();

    let newlineIndex: number;
    while ((newlineIndex = this.lineBuffer.indexOf('\n')) !== -1) {
      const line = this.lineBuffer.slice(0, newlineIndex).trim();
      this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1);

      if (line.length === 0) continue;
      this.handleJsonPayload(line);
    }
  }

  /**
   * Parses Content-Length framed JSON-RPC messages (MCP stdio spec).
   */
  private parseContentLengthData(data: Buffer): void {
    this.frameBuffer = Buffer.concat([this.frameBuffer, data]);

    while (this.frameBuffer.length > 0) {
      const header = this.findHeaderEnd(this.frameBuffer);
      if (!header) {
        // Compatibility: some legacy MCP servers speak newline-delimited JSON-RPC.
        // If buffered stdout looks like JSON lines, parse it immediately instead of
        // waiting for a Content-Length timeout.
        const preview = this.frameBuffer.toString('utf8', 0, Math.min(this.frameBuffer.length, 256));
        const trimmed = preview.trimStart();
        const looksLikeJsonLine = trimmed.startsWith('{') || trimmed.startsWith('[');
        if (looksLikeJsonLine && this.frameBuffer.includes(0x0a)) {
          this.parseLineDelimitedData(this.frameBuffer);
          this.frameBuffer = Buffer.alloc(0);
        }
        return;
      }

      const headersText = this.frameBuffer.subarray(0, header.index).toString('utf8');
      const contentLength = this.extractContentLength(headersText);

      if (contentLength === null) {
        // Not a framed protocol message. Consume one line as diagnostic.
        const newlineIndex = this.frameBuffer.indexOf('\n');
        if (newlineIndex === -1) return;

        const line = this.frameBuffer.subarray(0, newlineIndex).toString('utf8').trim();
        this.frameBuffer = this.frameBuffer.subarray(newlineIndex + 1);
        if (line.length > 0) {
          this.handleJsonPayload(line);
        }
        continue;
      }

      const payloadStart = header.index + header.separatorLength;
      const payloadEnd = payloadStart + contentLength;

      if (this.frameBuffer.length < payloadEnd) {
        return;
      }

      const json = this.frameBuffer.subarray(payloadStart, payloadEnd).toString('utf8').trim();
      this.frameBuffer = this.frameBuffer.subarray(payloadEnd);

      if (json.length > 0) {
        this.handleJsonPayload(json);
      }
    }
  }

  /**
   * Finds the end of a stdio frame header block.
   */
  private findHeaderEnd(
    buffer: Buffer
  ): { index: number; separatorLength: number } | null {
    const crlfIndex = buffer.indexOf('\r\n\r\n');
    const lfIndex = buffer.indexOf('\n\n');

    if (crlfIndex === -1 && lfIndex === -1) return null;
    if (crlfIndex !== -1 && (lfIndex === -1 || crlfIndex < lfIndex)) {
      return { index: crlfIndex, separatorLength: 4 };
    }

    return { index: lfIndex, separatorLength: 2 };
  }

  /**
   * Extracts Content-Length header value from frame headers.
   */
  private extractContentLength(headers: string): number | null {
    const lines = headers.split(/\r?\n/);

    for (const line of lines) {
      const match = /^content-length\s*:\s*(\d+)\s*$/i.exec(line.trim());
      if (!match) continue;

      const parsed = Number.parseInt(match[1], 10);
      if (Number.isNaN(parsed) || parsed < 0) return null;
      return parsed;
    }

    return null;
  }

  /**
   * Parses and routes a single JSON-RPC payload.
   */
  private handleJsonPayload(json: string): void {
    try {
      const message = JSON.parse(json) as JsonRpcResponse;
      this.handleMessage(message);
    } catch {
      // Non-JSON output, ignore (could be server logs)
      this.emit('stderr', `Non-JSON output: ${json}`);
    }
  }
}

// ============================================================================
// MCP HTTP Connection (Streamable HTTP Transport)
// ============================================================================

/** Manages HTTP-based JSON-RPC communication with an MCP server */
class McpHttpConnection extends EventEmitter {
  private nextId = 1;
  private sessionId: string | null = null;
  private readonly lifetimeController = new AbortController();
  private stopped = false;

  /** Default timeout for HTTP requests in milliseconds */
  private static readonly REQUEST_TIMEOUT_MS = 30_000;

  constructor(private readonly config: McpServerConfig) {
    super();
  }

  /**
   * No-op for HTTP transport (no persistent process to start).
   */
  async start(): Promise<void> {
    // HTTP transport doesn't need a persistent connection
  }

  /**
   * Sends a JSON-RPC 2.0 request via HTTP POST and returns the response.
   */
  async request(
    method: string,
    params?: Record<string, unknown>,
    options: McpRequestOptions = {},
  ): Promise<unknown> {
    if (options.signal?.aborted) {
      throw new McpRequestAbortedError();
    }
    if (this.stopped) throw new McpRequestAbortedError('MCP connection closed');
    if (!this.config.url) {
      throw new Error(`MCP HTTP server "${this.config.name}" has no URL configured`);
    }

    const id = this.nextId++;
    const body: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...(this.config.headers ?? {}),
    };

    // Include session ID if we have one from a previous response
    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    const controller = new AbortController();
    let timedOut = false;
    let rejectCancellation: ((error: Error) => void) | undefined;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });

    const handleAbort = (): void => {
      controller.abort();
      rejectCancellation?.(new McpRequestAbortedError());
    };
    const handleLifetimeAbort = (): void => {
      controller.abort();
      rejectCancellation?.(new McpRequestAbortedError('MCP connection closed'));
    };
    options.signal?.addEventListener('abort', handleAbort, { once: true });
    this.lifetimeController.signal.addEventListener('abort', handleLifetimeAbort, { once: true });

    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      rejectCancellation?.(
        new Error(`MCP HTTP request "${method}" timed out after ${McpHttpConnection.REQUEST_TIMEOUT_MS}ms`)
      );
    }, McpHttpConnection.REQUEST_TIMEOUT_MS);
    timeout.unref?.();

    const raceCancellation = <T>(operation: Promise<T>): Promise<T> =>
      Promise.race([operation, cancellation]);

    try {
      const response = await raceCancellation(fetch(this.config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      }));

      if (!response.ok) {
        const text = await raceCancellation(response.text()).catch((error) => {
          if (error instanceof McpRequestAbortedError || timedOut) throw error;
          return '';
        });
        throw new Error(
          `MCP HTTP request "${method}" failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`
        );
      }

      // Capture session ID from response headers
      const newSessionId = response.headers.get('mcp-session-id');
      if (newSessionId) {
        this.sessionId = newSessionId;
      }

      const contentType = response.headers.get('content-type') ?? '';

      // Handle SSE response (text/event-stream) - extract the last JSON-RPC result
      if (contentType.includes('text/event-stream')) {
        const text = await raceCancellation(response.text());
        return this.parseSSEResponse(text, id);
      }

      // Handle standard JSON response
      const result = (await raceCancellation(response.json())) as JsonRpcResponse;

      if (result.error) {
        throw new Error(
          `MCP error (${result.error.code}): ${result.error.message}`
        );
      }

      return result.result;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if ((options.signal?.aborted || this.lifetimeController.signal.aborted) && !timedOut) {
          throw error instanceof McpRequestAbortedError
            ? error
            : new McpRequestAbortedError(
              this.lifetimeController.signal.aborted
                ? 'MCP connection closed'
                : 'MCP request aborted'
            );
        }
        throw new Error(`MCP HTTP request "${method}" timed out after ${McpHttpConnection.REQUEST_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', handleAbort);
      this.lifetimeController.signal.removeEventListener('abort', handleLifetimeAbort);
    }
  }

  /**
   * Sends a JSON-RPC 2.0 notification via HTTP POST (fire-and-forget).
   */
  notify(method: string, params?: Record<string, unknown>): void {
    if (!this.config.url || this.stopped) return;

    const body: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params !== undefined ? { params } : {}),
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.config.headers ?? {}),
    };

    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    // Fire and forget
    fetch(this.config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: this.lifetimeController.signal,
    }).catch(() => {
      // Notifications are best-effort
    });
  }

  /**
   * No persistent process to stop for HTTP transport.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    this.lifetimeController.abort();
    this.sessionId = null;
  }

  /**
   * Parses an SSE (text/event-stream) response to extract the JSON-RPC result.
   */
  private parseSSEResponse(text: string, _expectedId: number): unknown {
    const lines = text.split('\n');
    let lastData = '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        lastData = line.slice(6);
      }
    }

    if (!lastData) {
      throw new Error('No data found in SSE response');
    }

    try {
      const parsed = JSON.parse(lastData) as JsonRpcResponse;
      if (parsed.error) {
        throw new Error(`MCP error (${parsed.error.code}): ${parsed.error.message}`);
      }
      return parsed.result;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in SSE response: ${lastData.slice(0, 100)}`);
      }
      throw error;
    }
  }
}

// ============================================================================
// MCP Client Manager
// ============================================================================

/**
 * Manages connections to multiple MCP servers and provides
 * a unified interface for tool discovery and invocation.
 *
 * Tools from MCP servers are registered with the naming convention
 * `mcp__<serverName>__<toolName>` to avoid collisions with built-in tools.
 *
 * @example
 * ```typescript
 * const manager = new McpClientManager();
 * await manager.connect({
 *   name: 'filesystem',
 *   transport: 'stdio',
 *   command: 'npx',
 *   args: ['-y', '@modelcontextprotocol/server-filesystem'],
 * });
 *
 * const tools = manager.getAllTools();
 * const result = await manager.callTool('filesystem', 'read_file', { path: '/tmp/test.txt' });
 * ```
 */
export class McpClientManager {
  private servers = new Map<string, McpServerState>();
  private connections = new Map<string, McpStdioConnection | McpHttpConnection>();
  private inFlightConnections = new Set<McpStdioConnection | McpHttpConnection>();
  private connectionAttempts = new Map<string, Promise<void>>();
  private connectionGeneration = 0;
  private disconnectAllPromise: Promise<void> | null = null;

  // ============================================================================
  // Static Helper Methods
  // ============================================================================

  /**
   * Checks if a tool name belongs to MCP (starts with mcp__ prefix).
   * @param toolName - The tool name to check
   * @returns true if the tool is an MCP tool
   */
  static isMcpTool(toolName: string): boolean {
    return toolName.startsWith('mcp__');
  }

  /**
   * Extracts the server name and tool name from a prefixed MCP tool name.
   * The expected format is `mcp__<serverName>__<toolName>`.
   *
   * @param prefixedName - The full prefixed tool name
   * @returns Object with serverName and toolName, or null if invalid format
   */
  static parseMcpToolName(prefixedName: string): { serverName: string; toolName: string } | null {
    if (!prefixedName.startsWith('mcp__')) return null;

    const withoutPrefix = prefixedName.slice(5); // Remove 'mcp__'
    const separatorIndex = withoutPrefix.indexOf('__');

    if (separatorIndex <= 0) return null;

    const serverName = withoutPrefix.slice(0, separatorIndex);
    const toolName = withoutPrefix.slice(separatorIndex + 2);

    if (!serverName || !toolName) return null;

    return { serverName, toolName };
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  /**
   * Connects to all configured MCP servers.
   * Servers with `autoConnect: false` are skipped.
   * Connection failures for individual servers are caught and logged
   * but do not prevent other servers from connecting.
   *
   * @param configs - Array of server configurations
   */
  async connectAll(configs: McpServerConfig[]): Promise<void> {
    const connectPromises = configs
      .filter((config) => config.autoConnect !== false)
      .map(async (config) => {
        try {
          await this.connect(config);
        } catch (error) {
          if (error instanceof McpConnectionCancelledError) return;
          // Store the error state but don't throw
          this.servers.set(config.name, {
            config,
            status: 'error',
            tools: [],
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

    await Promise.all(connectPromises);
  }

  /**
   * Connects to a single MCP server. Performs the MCP initialize handshake,
   * discovers available tools, and registers them.
   *
   * @param config - Server configuration
   * @throws {Error} If the configuration is invalid or connection fails
   */
  async connect(config: McpServerConfig): Promise<void> {
    if (this.disconnectAllPromise) {
      throw new McpConnectionCancelledError();
    }
    validateMcpServerConfig(config);
    const existingAttempt = this.connectionAttempts.get(config.name);
    if (existingAttempt) return existingAttempt;

    const generation = this.connectionGeneration;
    const connecting = this.performConnect(config, generation);
    const tracked = connecting.finally(() => {
      if (this.connectionAttempts.get(config.name) === tracked) {
        this.connectionAttempts.delete(config.name);
      }
    });
    this.connectionAttempts.set(config.name, tracked);
    return tracked;
  }

  private async performConnect(config: McpServerConfig, generation: number): Promise<void> {
    // Disconnect existing connection if any
    if (this.servers.has(config.name)) {
      await this.disconnect(config.name);
    }
    this.assertConnectionGeneration(generation);
    if (this.disconnectAllPromise) {
      throw new McpConnectionCancelledError();
    }

    if (config.transport === 'stdio') {
      await this.connectStdio(config, generation);
    } else if (config.transport === 'http') {
      await this.connectHttp(config, generation);
    } else if (config.transport === 'sse') {
      await this.connectSse(config);
    }
  }

  /**
   * Disconnects from a specific MCP server.
   *
   * @param serverName - Name of the server to disconnect
   * @throws {Error} If the server is not found
   */
  async disconnect(serverName: string): Promise<void> {
    const connection = this.connections.get(serverName);
    if (!connection && !this.servers.has(serverName)) {
      throw new Error(`MCP server not found: "${serverName}"`);
    }

    if (connection) {
      await connection.stop();
      this.connections.delete(serverName);
    }

    this.servers.delete(serverName);
  }

  /**
   * Disconnects from all connected MCP servers.
   */
  disconnectAll(): Promise<void> {
    if (this.disconnectAllPromise) return this.disconnectAllPromise;

    this.connectionGeneration += 1;
    const connections = new Set([
      ...this.connections.values(),
      ...this.inFlightConnections.values(),
    ]);
    const connectionAttempts = [...this.connectionAttempts.values()];
    this.connections.clear();
    this.inFlightConnections.clear();
    this.servers.clear();
    const closing = Promise.all([
      ...[...connections].map((connection) => connection.stop().catch(() => {})),
      ...connectionAttempts.map((attempt) => attempt.catch(() => {})),
    ]).then(() => undefined);
    const tracked = closing.finally(() => {
      if (this.disconnectAllPromise === tracked) this.disconnectAllPromise = null;
    });
    this.disconnectAllPromise = tracked;
    return tracked;
  }

  // ============================================================================
  // Tool Discovery
  // ============================================================================

  /**
   * Returns all known servers with their status and tool count.
   * @returns Array of server summaries
   */
  getServers(): Array<{ name: string; status: string; toolCount: number }> {
    const result: Array<{ name: string; status: string; toolCount: number }> = [];
    for (const [name, state] of this.servers) {
      result.push({
        name,
        status: state.status,
        toolCount: state.tools.length,
      });
    }
    return result;
  }

  /**
   * Returns all available tools from all connected servers.
   * @returns Array of tool definitions
   */
  getAllTools(): McpToolDefinition[] {
    const allTools: McpToolDefinition[] = [];
    for (const state of this.servers.values()) {
      if (state.status === 'connected') {
        allTools.push(...state.tools);
      }
    }
    return allTools;
  }

  /**
   * Returns tools from a specific server.
   * @param serverName - Name of the server
   * @returns Array of tool definitions from that server
   */
  getToolsForServer(serverName: string): McpToolDefinition[] {
    const state = this.servers.get(serverName);
    if (!state || state.status !== 'connected') return [];
    return state.tools;
  }

  // ============================================================================
  // Tool Execution
  // ============================================================================

  /**
   * Calls a tool on a specific MCP server.
   *
   * @param serverName - Name of the server providing the tool
   * @param toolName - Name of the tool (without mcp__ prefix)
   * @param args - Arguments to pass to the tool
   * @returns The tool's result
   * @throws {Error} If the server is not connected or the tool call fails
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    options: McpRequestOptions = {},
  ): Promise<unknown> {
    const connection = this.connections.get(serverName);
    const state = this.servers.get(serverName);

    if (!connection || !state || state.status !== 'connected') {
      throw new Error(`MCP server not found or not connected: "${serverName}"`);
    }

    // Strip internal agent metadata fields that are not part of MCP tool schemas.
    const toolArgs = { ...args };
    delete (toolArgs as { type?: unknown }).type;

    const result = await connection.request('tools/call', {
      name: toolName,
      arguments: toolArgs,
    }, options);

    return result;
  }

  // ============================================================================
  // Server Status
  // ============================================================================

  /**
   * Lists all known servers with their connection status and tool count.
   * @returns Array of server status objects
   */
  listServers(): Array<{ name: string; status: McpServerStatus; toolCount: number; error?: string }> {
    return Array.from(this.servers.values()).map((state) => ({
      name: state.config.name,
      status: state.status,
      toolCount: state.tools.length,
      error: state.error,
    }));
  }

  // ============================================================================
  // Private: Transport-Specific Connection Logic
  // ============================================================================

  /**
   * Connects to an MCP server via stdio transport.
   * Spawns the server process, performs the MCP initialize handshake,
   * and discovers available tools.
   */
  private async connectStdio(config: McpServerConfig, generation: number): Promise<void> {
    try {
      const connected = await this.connectStdioWithFallbackFraming(config, generation);
      await this.registerConnectedStdioServer(config, connected.connection, connected.tools, generation);
    } catch (error) {
      if (error instanceof McpConnectionCancelledError) throw error;
      if (!this.shouldRetryNpxWithIsolatedCache(config, error)) {
        throw error;
      }

      const retryConfig: McpServerConfig = {
        ...config,
        env: buildNpxIsolatedCacheEnv(config.env, config.name),
      };

      try {
        const connected = await this.connectStdioWithFallbackFraming(retryConfig, generation);
        // Keep persisted config intact; retry cache env is only a runtime override.
        await this.registerConnectedStdioServer(config, connected.connection, connected.tools, generation);
      } catch (retryError) {
        if (retryError instanceof McpConnectionCancelledError) throw retryError;
        const initialMessage = error instanceof Error ? error.message : String(error);
        const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
        throw new Error(`${initialMessage}\nRetry with isolated npm cache failed: ${retryMessage}`);
      }
    }
  }

  private shouldRetryNpxWithIsolatedCache(config: McpServerConfig, error: unknown): boolean {
    if (!config.command || !isNpxCommand(config.command)) {
      return false;
    }
    const message = error instanceof Error ? error.message : String(error);
    return isRetriableNpxInstallError(message);
  }

  /**
   * Some MCP servers still use newline-delimited JSON-RPC over stdio.
   * Start with Content-Length framing (spec), then fallback to newline when
   * initialize stalls/closes without a successful handshake.
   */
  private shouldRetryWithNewlineFraming(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('MCP request "initialize" timed out')
      || message.includes('MCP connection closed before initialization completed')
      || message.includes('MCP connection closed (server exited with code')
    );
  }

  private async connectStdioWithFallbackFraming(
    config: McpServerConfig,
    generation: number,
  ): Promise<{ connection: McpStdioConnection; tools: McpToolDefinition[] }> {
    try {
      return await this.connectStdioWithFraming(config, 'content-length', generation);
    } catch (contentLengthError) {
      if (contentLengthError instanceof McpConnectionCancelledError) throw contentLengthError;
      if (!this.shouldRetryWithNewlineFraming(contentLengthError)) {
        throw contentLengthError;
      }

      try {
        return await this.connectStdioWithFraming(config, 'newline', generation);
      } catch (newlineError) {
        if (newlineError instanceof McpConnectionCancelledError) throw newlineError;
        const first = contentLengthError instanceof Error
          ? contentLengthError.message
          : String(contentLengthError);
        const second = newlineError instanceof Error ? newlineError.message : String(newlineError);
        throw new Error(`${first}\nRetry with newline framing failed: ${second}`);
      }
    }
  }

  /**
   * Tries to establish a stdio MCP connection with a specific framing mode.
   */
  private async connectStdioWithFraming(
    config: McpServerConfig,
    framing: 'content-length' | 'newline',
    generation: number,
  ): Promise<{ connection: McpStdioConnection; tools: McpToolDefinition[] }> {
    this.assertConnectionGeneration(generation);
    const connection = new McpStdioConnection(config, framing);
    this.inFlightConnections.add(connection);

    // Track error state
    let connectionError: Error | null = null;

    // Capture stderr output for diagnostics
    let stderrOutput = '';
    let closeCode: number | null | undefined;
    let handshakeComplete = false;

    connection.on('error', (err: Error) => {
      connectionError = err;
      const state = this.servers.get(config.name);
      if (state) {
        state.status = 'error';
        state.error = err.message;
      }
    });

    connection.on('close', (code: number | null | undefined) => {
      closeCode = code;
      if (handshakeComplete || connectionError) return;

      connectionError = new Error(
        typeof code === 'number'
          ? `MCP server process exited with code ${code}`
          : 'MCP server process exited before completing initialization'
      );
    });

    connection.on('stderr', (data: string) => {
      stderrOutput += data;
    });

    try {
      await connection.start();
      this.assertConnectionGeneration(generation);

      if (connectionError) {
        throw connectionError;
      }

      // MCP Initialize handshake
      await connection.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        clientInfo: {
          name: 'autohand',
          version: '1.0.0',
        },
      });
      this.assertConnectionGeneration(generation);

      // Send initialized notification to complete handshake
      connection.notify('notifications/initialized');

      // Discover available tools
      const toolsResult = (await connection.request('tools/list', {})) as {
        tools?: McpRawTool[];
      };
      this.assertConnectionGeneration(generation);

      const tools: McpToolDefinition[] = (toolsResult?.tools ?? []).map((rawTool) =>
        convertMcpToolToAutohand(rawTool, config.name)
      );

      handshakeComplete = true;
      return { connection, tools };
    } catch (error) {
      // Clean up on failure
      await connection.stop().catch(() => {});
      if (error instanceof McpConnectionCancelledError) throw error;

      let errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg === 'MCP connection closed') {
        errMsg = typeof closeCode === 'number'
          ? `MCP connection closed (server exited with code ${closeCode})`
          : 'MCP connection closed before initialization completed';
      }

      // Enrich error with stderr output for diagnostics
      const detail = stderrOutput.trim();
      if (detail) {
        const stderrSnippet = detail.length > 500 ? detail.slice(-500) : detail;
        throw new Error(`${errMsg}\n  Server stderr (tail): ${stderrSnippet}`);
      }

      throw new Error(errMsg);
    } finally {
      if (!handshakeComplete) this.inFlightConnections.delete(connection);
    }
  }

  /**
   * Stores connected server state and attaches lifecycle listeners.
   */
  private async registerConnectedStdioServer(
    config: McpServerConfig,
    connection: McpStdioConnection,
    tools: McpToolDefinition[],
    generation: number,
  ): Promise<void> {
    if (generation !== this.connectionGeneration) {
      this.inFlightConnections.delete(connection);
      await connection.stop().catch(() => {});
      throw new McpConnectionCancelledError();
    }
    connection.on('close', (code: number | null | undefined) => {
      const state = this.servers.get(config.name);
      // Only mutate state if currently connected.
      // Preserve existing error state from handshake failures.
      if (state && state.status === 'connected') {
        state.status = 'error';
        state.error = typeof code === 'number'
          ? `MCP server process exited with code ${code}`
          : 'MCP server disconnected unexpectedly';
      }
    });

    // Store server state
    this.servers.set(config.name, {
      config,
      status: 'connected',
      tools,
    });

    this.connections.set(config.name, connection);
    this.inFlightConnections.delete(connection);
  }

  /**
   * Connects to an MCP server via HTTP (Streamable HTTP) transport.
   * Sends JSON-RPC requests as HTTP POST to the configured URL.
   */
  private async connectHttp(config: McpServerConfig, generation: number): Promise<void> {
    this.assertConnectionGeneration(generation);
    const connection = new McpHttpConnection(config);
    this.inFlightConnections.add(connection);

    try {
      await connection.start();
      this.assertConnectionGeneration(generation);

      // MCP Initialize handshake
      await connection.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        clientInfo: {
          name: 'autohand',
          version: '1.0.0',
        },
      });
      this.assertConnectionGeneration(generation);

      // Send initialized notification to complete handshake
      connection.notify('notifications/initialized');

      // Discover available tools
      const toolsResult = (await connection.request('tools/list', {})) as {
        tools?: McpRawTool[];
      };
      this.assertConnectionGeneration(generation);

      const tools: McpToolDefinition[] = (toolsResult?.tools ?? []).map((rawTool) =>
        convertMcpToolToAutohand(rawTool, config.name)
      );

      // Store server state
      this.servers.set(config.name, {
        config,
        status: 'connected',
        tools,
      });

      this.connections.set(config.name, connection);
    } catch (error) {
      await connection.stop().catch(() => {});
      throw error;
    } finally {
      this.inFlightConnections.delete(connection);
    }
  }

  private assertConnectionGeneration(generation: number): void {
    if (generation !== this.connectionGeneration) {
      throw new McpConnectionCancelledError();
    }
  }

  /**
   * Connects to an MCP server via SSE transport.
   * Currently a placeholder -- SSE transport requires an HTTP client
   * with SSE support which will be added in a future iteration.
   */
  private async connectSse(config: McpServerConfig): Promise<void> {
    // SSE transport is not yet fully implemented.
    // For now, store the config as disconnected with a note.
    this.servers.set(config.name, {
      config,
      status: 'error',
      tools: [],
      error: 'SSE transport is not yet implemented. Use stdio or http transport instead.',
    });

    throw new Error(
      `SSE transport for MCP server "${config.name}" is not yet implemented. Use stdio or http transport instead.`
    );
  }
}
