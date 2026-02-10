/**
 * ACP Mode Entry Point
 * Runs the Autohand CLI as a native ACP agent over stdio.
 *
 * Protocol: ndJSON over stdin/stdout (ACP specification).
 * All console output is redirected to stderr to keep stdout clean.
 */

import { Readable, Writable } from 'node:stream';
import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { AutohandAcpAdapter } from './adapter.js';
import type { CLIOptions } from '../../types.js';

/**
 * Redirect all console methods to stderr.
 * stdout is reserved exclusively for ACP protocol messages.
 */
function redirectConsoleToStderr(): void {
  const stderrWrite = (...args: unknown[]) => {
    process.stderr.write(args.map(String).join(' ') + '\n');
  };

  console.log = stderrWrite;
  console.info = stderrWrite;
  console.warn = stderrWrite;
  console.debug = stderrWrite;
  // Keep console.error pointing to stderr (it already does)
}

/**
 * Run the CLI in native ACP mode.
 *
 * This replaces the external autohand-acp adapter:
 *   Before: Zed -> autohand-acp -> spawns autohand --mode rpc -> JSON-RPC
 *   After:  Zed -> autohand --mode acp -> in-process ACP protocol
 */
export async function runAcpMode(_options: CLIOptions): Promise<void> {
  // Redirect all console output to stderr
  redirectConsoleToStderr();

  // Set client name for identification
  process.env.AUTOHAND_CLIENT_NAME = 'acp';

  process.stderr.write('[ACP] Starting native ACP mode...\n');

  // Error handlers
  process.on('unhandledRejection', (reason, promise) => {
    process.stderr.write(`[ACP] Unhandled Rejection at: ${promise}, reason: ${reason}\n`);
  });

  process.on('uncaughtException', (error) => {
    process.stderr.write(`[ACP] Uncaught Exception: ${error.message}\n${error.stack}\n`);
  });

  // Create Web stream wrappers for Node stdio
  // ACP SDK expects Web Streams (ReadableStream/WritableStream)
  const input = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
  const output = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;

  // Create ndJSON stream for ACP protocol
  const stream = ndJsonStream(input, output);

  // Create the ACP connection with our adapter
  const _connection = new AgentSideConnection(
    (conn) => new AutohandAcpAdapter(conn),
    stream,
  );

  // Keep process alive — stdin will keep the event loop running
  process.stdin.resume();

  // Monitor connection lifecycle
  _connection.signal.addEventListener('abort', () => {
    process.stderr.write('[ACP] Connection closed.\n');
    process.exit(0);
  });

  process.stderr.write('[ACP] Native ACP mode ready. Waiting for client...\n');
}

export { AutohandAcpAdapter } from './adapter.js';
export * from './types.js';
export * from './permissions.js';
