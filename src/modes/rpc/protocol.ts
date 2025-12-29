/**
 * RPC Protocol Handler
 * JSON-line parsing and serialization for stdio communication
 */

import type { RPCCommand, RPCEvent } from './types.js';

/**
 * Parse a JSON-line command from the client
 */
export function parseCommand(line: string): RPCCommand | null {
  try {
    const trimmed = line.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = JSON.parse(trimmed);

    // Validate required fields
    if (!parsed.type || !parsed.id) {
      return null;
    }

    return parsed as RPCCommand;
  } catch {
    return null;
  }
}

/**
 * Serialize an event to JSON-line format
 */
export function serializeEvent(event: RPCEvent): string {
  return JSON.stringify(event);
}

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

/**
 * Buffered line reader for stdin
 */
export class LineReader {
  private buffer = '';
  private lineQueue: string[] = [];
  private resolvers: Array<(line: string) => void> = [];

  constructor(private stream: NodeJS.ReadableStream) {
    this.stream.setEncoding('utf8');
    this.stream.on('data', (chunk: string) => this.handleData(chunk));
    this.stream.on('end', () => this.handleEnd());
  }

  private handleData(chunk: string): void {
    this.buffer += chunk;

    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

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
}

/**
 * Write an event to stdout
 */
export function writeEvent(event: RPCEvent): void {
  const line = serializeEvent(event) + '\n';
  process.stdout.write(line);
}

/**
 * Write a response event
 */
export function writeResponse(
  id: string,
  command: string,
  success: boolean,
  result?: unknown,
  error?: string
): void {
  writeEvent({
    type: 'response',
    timestamp: createTimestamp(),
    data: {
      id,
      command,
      success,
      result,
      error,
    },
  });
}

/**
 * Write an error event
 */
export function writeError(
  code: string,
  message: string,
  recoverable: boolean = true
): void {
  writeEvent({
    type: 'error',
    timestamp: createTimestamp(),
    data: {
      code,
      message,
      recoverable,
    },
  });
}
