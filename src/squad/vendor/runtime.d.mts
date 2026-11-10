import type { Readable, Writable } from 'node:stream';
export interface SquadBridge {
  get(path: string): Promise<unknown>;
  post(path: string, body?: Record<string, unknown>): Promise<unknown>;
  patch(path: string, body?: Record<string, unknown>): Promise<unknown>;
  put(path: string, body?: Record<string, unknown>): Promise<unknown>;
}
export function createBridgeClient(origin: string, options?: { fetchImpl?: typeof fetch }): SquadBridge;
export function createTools(bridge: SquadBridge): Record<string, (args?: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown>>;
export function createRpcHandler(tools: ReturnType<typeof createTools>, options?: { bridgeUrl?: string }): (request: unknown) => Promise<unknown>;
export function serveStdio(options: { input?: Readable; output?: Writable; handle: ReturnType<typeof createRpcHandler> }): Promise<void>;
