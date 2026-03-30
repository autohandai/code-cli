/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bridge for browser tool invocations. The action executor sends a
 * JSON-RPC request; this bridge holds the pending promise until the
 * extension responds.
 *
 * IMPORTANT: output defaults to a no-op. Call setBrowserBridgeOutput()
 * to direct messages to the correct transport (native host stdout,
 * RPC channel, etc.). Writing raw JSON to process.stdout in interactive
 * mode corrupts the terminal display.
 */

interface PendingRequest {
  resolve: (result: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingRequest>();
const TIMEOUT_MS = 30_000;

/** Configurable output stream — defaults to no-op to avoid stdout corruption. */
let bridgeOutput: { write: (data: string) => boolean | void } | null = null;

/**
 * Set the output stream for browser bridge JSON-RPC messages.
 * Must be called before invoking browser tools (e.g. during chrome setup).
 */
export function setBrowserBridgeOutput(output: { write: (data: string) => boolean | void }): void {
  bridgeOutput = output;
}

/**
 * Send a browser tool invoke request and wait for the response.
 */
export function invokeBrowserTool(
  toolName: string,
  input: Record<string, unknown>,
): Promise<string> {
  const requestId = `browser_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const notification = {
    jsonrpc: '2.0',
    method: 'autohand.mcp.invokeRequest',
    params: { requestId, toolName, input },
  };

  if (bridgeOutput) {
    bridgeOutput.write(JSON.stringify(notification) + '\n');
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`Browser tool ${toolName} timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    pending.set(requestId, { resolve, reject, timer });
  });
}

/**
 * Called by the RPC handler when the extension sends back a response.
 */
export function resolveBrowserToolResponse(
  requestId: string,
  success: boolean,
  result?: string,
  error?: string,
): boolean {
  const req = pending.get(requestId);
  if (!req) return false;

  pending.delete(requestId);
  clearTimeout(req.timer);

  if (success) {
    req.resolve(result || 'Tool executed successfully.');
  } else {
    req.reject(new Error(error || 'Browser tool failed.'));
  }
  return true;
}
