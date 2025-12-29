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
 */
export function serialize(obj: JsonRpcRequest | JsonRpcResponse): string {
  return JSON.stringify(obj);
}

/**
 * Serialize an array of responses (batch response)
 */
export function serializeBatch(responses: JsonRpcResponse[]): string {
  return JSON.stringify(responses);
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
  private resolvers: Array<(line: string) => void> = [];
  private closed = false;

  constructor(private stream: NodeJS.ReadableStream) {
    this.stream.setEncoding('utf8');
    this.stream.on('data', (chunk: string) => this.handleData(chunk));
    this.stream.on('end', () => this.handleEnd());
    this.stream.on('close', () => this.handleClose());
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
    this.closed = true;
  }

  private handleClose(): void {
    this.closed = true;
  }

  private deliverLine(line: string): void {
    if (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift()!;
      resolver(line);
    } else {
      this.lineQueue.push(line);
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

    return new Promise((resolve) => {
      this.resolvers.push(resolve);
    });
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
 */
export function writeResponse(id: JsonRpcId, result: unknown): void {
  const response = createResponse(id, result);
  process.stdout.write(serialize(response) + '\n');
}

/**
 * Write a JSON-RPC 2.0 error response to stdout
 */
export function writeErrorResponse(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown
): void {
  const response = createErrorResponse(id, code, message, data);
  process.stdout.write(serialize(response) + '\n');
}

/**
 * Write a batch of responses to stdout
 */
export function writeBatchResponse(responses: JsonRpcResponse[]): void {
  if (responses.length > 0) {
    process.stdout.write(serializeBatch(responses) + '\n');
  }
}

/**
 * Write a JSON-RPC 2.0 notification to stdout (no id, no response expected)
 */
export function writeNotification(method: string, params?: JsonRpcParams): void {
  const notification = createNotification(method, params);
  process.stdout.write(serialize(notification) + '\n');
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
