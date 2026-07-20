/**
 * RPC Protocol Handler
 * JSON-RPC 2.0 parsing and serialization for stdio communication
 * Spec: https://www.jsonrpc.org/specification
 */

import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcId,
  JsonRpcParams,
} from './types.js';
import {
  isJsonRpcRequest,
  isJsonRpcBatch,
  createResponse,
  createErrorResponse,
  createNotification,
  JSON_RPC_ERROR_CODES,
} from './types.js';
import { getRpcErrorMetadata, getRpcIdMetadata, writeRpcDebugLine } from './logging.js';

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse result from parseRequest
 */
export type ParseResult =
  | { type: 'single'; request: JsonRpcRequest }
  | { type: 'batch'; requests: JsonRpcRequest[] }
  | { type: 'error'; code: number; message: string };

/**
 * Parse a JSON-RPC 2.0 request (single or batch) from a line
 */
export function parseRequest(line: string): ParseResult {
  const trimmed = line.trim();
  if (!trimmed) {
    return {
      type: 'error',
      code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      message: 'Empty request',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      type: 'error',
      code: JSON_RPC_ERROR_CODES.PARSE_ERROR,
      message: 'Parse error: Invalid JSON',
    };
  }

  // Check for batch request
  if (isJsonRpcBatch(parsed)) {
    const validRequests: JsonRpcRequest[] = [];
    for (const item of parsed) {
      if (isJsonRpcRequest(item)) {
        validRequests.push(item);
      }
    }

    if (validRequests.length === 0) {
      return {
        type: 'error',
        code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
        message: 'Invalid batch: No valid requests',
      };
    }

    return { type: 'batch', requests: validRequests };
  }

  // Single request
  if (isJsonRpcRequest(parsed)) {
    return { type: 'single', request: parsed };
  }

  return {
    type: 'error',
    code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
    message: 'Invalid request: Missing jsonrpc version or method',
  };
}

// ============================================================================
// Serialization
// ============================================================================

/**
 * Serialize a JSON-RPC response/notification to JSON-line format
 * Handles serialization errors gracefully to prevent silent crashes
 */
export function serialize(obj: JsonRpcRequest | JsonRpcResponse): string {
  try {
    return JSON.stringify(obj);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown serialization error';
    writeRpcDebugLine(`Serialization failed: ${getRpcErrorMetadata(error)}`);
    // Return a minimal error response that can still be serialized
    return JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
        message: `Serialization failed: ${message}`,
      },
      id: null,
    });
  }
}

/**
 * Serialize an array of responses (batch response)
 * Handles serialization errors gracefully to prevent silent crashes
 */
export function serializeBatch(responses: JsonRpcResponse[]): string {
  try {
    return JSON.stringify(responses);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown serialization error';
    writeRpcDebugLine(`Batch serialization failed: ${getRpcErrorMetadata(error)}`);
    // Return an array with a single error response
    return JSON.stringify([{
      jsonrpc: '2.0',
      error: {
        code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
        message: `Batch serialization failed: ${message}`,
      },
      id: null,
    }]);
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Create a timestamp for events
 */
export function createTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Generate a unique ID
 */
let idCounter = 0;
export function generateId(prefix: string = 'id'): string {
  return `${prefix}_${++idCounter}_${Date.now()}`;
}

// ============================================================================
// Line Reader
// ============================================================================

/**
 * Buffered line reader for stdin
 * Handles partial messages and newline-delimited JSON
 */
export class LineReader {
  private buffer = '';
  private lineQueue: string[] = [];
  private pendingReads: Array<{
    resolve: (line: string) => void;
    reject: (error: Error) => void;
  }> = [];
  private closed = false;
  private disposed = false;
  private readonly onData = (chunk: string): void => this.handleData(chunk);
  private readonly onEnd = (): void => this.handleEnd();
  private readonly onClose = (): void => this.handleClose();

  constructor(private stream: NodeJS.ReadableStream) {
    this.stream.setEncoding('utf8');
    this.stream.on('data', this.onData);
    this.stream.on('end', this.onEnd);
    this.stream.on('close', this.onClose);
  }

  private handleData(chunk: string): void {
    this.buffer += chunk;

    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      // Don't skip empty lines - let parseRequest handle validation
      if (line.trim()) {
        this.deliverLine(line);
      }
    }
  }

  private handleEnd(): void {
    // Process any remaining buffer content
    if (this.buffer.trim()) {
      this.deliverLine(this.buffer);
    }
    this.buffer = '';
    this.closePendingReads();
  }

  private handleClose(): void {
    this.closePendingReads();
  }

  private deliverLine(line: string): void {
    if (this.pendingReads.length > 0) {
      const pendingRead = this.pendingReads.shift()!;
      pendingRead.resolve(line);
    } else {
      this.lineQueue.push(line);
    }
  }

  private closePendingReads(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    const error = new Error('Stream closed');
    for (const pendingRead of this.pendingReads.splice(0)) {
      pendingRead.reject(error);
    }
  }

  /**
   * Read the next line (async)
   */
  async readLine(): Promise<string> {
    if (this.lineQueue.length > 0) {
      return this.lineQueue.shift()!;
    }

    if (this.closed) {
      throw new Error('Stream closed');
    }

    return new Promise((resolve, reject) => {
      this.pendingReads.push({ resolve, reject });
    });
  }

  /**
   * Detach stream listeners and settle any pending read.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.stream.removeListener('data', this.onData);
    this.stream.removeListener('end', this.onEnd);
    this.stream.removeListener('close', this.onClose);
    this.closePendingReads();
  }

  /**
   * Check if there are pending lines
   */
  hasPendingLines(): boolean {
    return this.lineQueue.length > 0;
  }

  /**
   * Check if the stream is closed
   */
  isClosed(): boolean {
    return this.closed;
  }
}

// ============================================================================
// Output Writers
// ============================================================================

/**
 * Write a JSON-RPC 2.0 response to stdout
 * Handles write errors gracefully to prevent silent crashes
 */
export function writeResponse(id: JsonRpcId, result: unknown): void {
  try {
    const response = createResponse(id, result);
    const serialized = serialize(response) + '\n';
    writeRpcDebugLine(`writeResponse ${getRpcIdMetadata(id)} size=${serialized.length}b`);
    process.stdout.write(serialized);
  } catch (error) {
    writeRpcDebugLine(`writeResponse failed ${getRpcIdMetadata(id)}: ${getRpcErrorMetadata(error)}`);
  }
}

/**
 * Write a JSON-RPC 2.0 error response to stdout
 * Handles write errors gracefully to prevent silent crashes
 */
export function writeErrorResponse(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown
): void {
  try {
    const response = createErrorResponse(id, code, message, data);
    const serialized = serialize(response) + '\n';
    writeRpcDebugLine(`writeErrorResponse ${getRpcIdMetadata(id)} size=${serialized.length}b`);
    process.stdout.write(serialized);
  } catch (error) {
    writeRpcDebugLine(`writeErrorResponse failed: ${getRpcErrorMetadata(error)}`);
  }
}

/**
 * Write a batch of responses to stdout
 * Handles write errors gracefully to prevent silent crashes
 */
export function writeBatchResponse(responses: JsonRpcResponse[]): void {
  if (responses.length > 0) {
    try {
      const serialized = serializeBatch(responses) + '\n';
      writeRpcDebugLine(`writeBatchResponse count=${responses.length} size=${serialized.length}b`);
      process.stdout.write(serialized);
    } catch (error) {
      writeRpcDebugLine(`writeBatchResponse failed: ${getRpcErrorMetadata(error)}`);
    }
  }
}

/**
 * Write a JSON-RPC 2.0 notification to stdout (no id, no response expected)
 * Handles write errors gracefully to prevent silent crashes
 */
export function writeNotification(method: string, params?: JsonRpcParams): void {
  try {
    const notification = createNotification(method, params);
    const serialized = serialize(notification) + '\n';
    if (method !== 'autohand.ping') {
      writeRpcDebugLine(`writeNotification method=${method} size=${serialized.length}b`);
    }
    process.stdout.write(serialized);
  } catch (error) {
    writeRpcDebugLine(`writeNotification failed method=${method}: ${getRpcErrorMetadata(error)}`);
  }
}

/**
 * Convenience function to write a parse error
 * (Used when request id cannot be determined)
 */
export function writeParseError(message: string = 'Parse error'): void {
  writeErrorResponse(null, JSON_RPC_ERROR_CODES.PARSE_ERROR, message);
}

/**
 * Convenience function to write an invalid request error
 */
export function writeInvalidRequestError(
  id: JsonRpcId,
  message: string = 'Invalid request'
): void {
  writeErrorResponse(id, JSON_RPC_ERROR_CODES.INVALID_REQUEST, message);
}

/**
 * Convenience function to write a method not found error
 */
export function writeMethodNotFoundError(id: JsonRpcId, method: string): void {
  writeErrorResponse(
    id,
    JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
    `Method not found: ${method}`
  );
}

/**
 * Convenience function to write an internal error
 */
export function writeInternalError(id: JsonRpcId, message: string, data?: unknown): void {
  writeErrorResponse(id, JSON_RPC_ERROR_CODES.INTERNAL_ERROR, message, data);
}
