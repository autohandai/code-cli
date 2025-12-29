/**
 * RPC Mode Entry Point
 * JSON-RPC 2.0 server for VS Code extension communication
 * Spec: https://www.jsonrpc.org/specification
 */

import { AutohandAgent } from '../../core/agent.js';
import { ConversationManager } from '../../core/conversationManager.js';
import { FileActionManager } from '../../actions/filesystem.js';
import { ProviderFactory } from '../../providers/ProviderFactory.js';
import { loadConfig } from '../../config.js';
import type { CLIOptions, AgentRuntime } from '../../types.js';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcId,
  PromptParams,
  GetMessagesParams,
  PermissionResponseParams,
} from './types.js';
import {
  RPC_METHODS,
  JSON_RPC_ERROR_CODES,
  isNotification,
  createResponse,
  createErrorResponse,
} from './types.js';
import { RPCAdapter } from './adapter.js';
import {
  LineReader,
  parseRequest,
  writeResponse,
  writeErrorResponse,
  writeBatchResponse,
  writeParseError,
  writeMethodNotFoundError,
  writeInternalError,
} from './protocol.js';

// Store original console methods
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  info: console.info,
  debug: console.debug,
};

/**
 * Suppress console output in RPC mode
 * All output must be JSON-RPC 2.0 messages
 */
function suppressConsole(): void {
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  console.info = () => {};
  console.debug = () => {};
}

/**
 * Restore console output (for debugging)
 */
export function restoreConsole(): void {
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.info = originalConsole.info;
  console.debug = originalConsole.debug;
}

/**
 * Run the CLI in JSON-RPC 2.0 mode
 */
export async function runRpcMode(options: CLIOptions): Promise<void> {
  // Suppress console output - all communication via JSON-RPC
  suppressConsole();

  let adapter: RPCAdapter | null = null;
  let agent: AutohandAgent | null = null;

  try {
    // Load configuration
    const config = await loadConfig(options.config);

    // Disable Ink renderer for RPC mode (stdin is not a TTY)
    if (!config.ui) {
      config.ui = {};
    }
    config.ui.useInkRenderer = false;

    // Determine workspace
    const workspaceRoot = options.path ?? process.cwd();

    // Create runtime
    // For MVP, auto-approve actions (like --yes flag)
    // TODO: Implement proper RPC-based permission handling
    const runtime: AgentRuntime = {
      config,
      workspaceRoot,
      options: {
        ...options,
        // Auto-approve for MVP - proper permission handling via RPC coming later
        yes: true,
      },
    };

    // Create LLM provider
    const provider = ProviderFactory.create(config);
    if (options.model) {
      provider.setModel(options.model);
    }

    // Create file action manager
    const files = new FileActionManager(workspaceRoot);

    // Create agent
    agent = new AutohandAgent(provider, files, runtime);

    // Initialize agent for RPC mode (sets up conversation, sessions, etc.)
    await agent.initializeForRPC();

    // Get conversation manager
    const conversation = ConversationManager.getInstance();

    // Create RPC adapter
    adapter = new RPCAdapter();
    adapter.initialize(
      agent,
      conversation,
      options.model ?? config.openrouter?.model ?? 'unknown',
      workspaceRoot
    );

    // Setup stdin reader
    const reader = new LineReader(process.stdin);

    // Main request loop
    while (true) {
      try {
        const line = await reader.readLine();
        await handleLine(line, adapter);
      } catch (error) {
        // Stream closed or fatal error
        if (error instanceof Error && error.message === 'Stream closed') {
          break;
        }
        const message = error instanceof Error ? error.message : String(error);
        writeInternalError(null, message);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeErrorResponse(null, JSON_RPC_ERROR_CODES.INTERNAL_ERROR, `Initialization error: ${message}`);
    adapter?.shutdown('error');
    process.exit(1);
  }
}

/**
 * Handle a single line of input (may contain single request or batch)
 */
async function handleLine(line: string, adapter: RPCAdapter): Promise<void> {
  const parseResult = parseRequest(line);

  if (parseResult.type === 'error') {
    writeErrorResponse(null, parseResult.code, parseResult.message);
    return;
  }

  if (parseResult.type === 'batch') {
    // Handle batch request
    const responses = await Promise.all(
      parseResult.requests.map((req) => handleSingleRequest(req, adapter))
    );

    // Filter out null responses (from notifications)
    const validResponses = responses.filter((r): r is JsonRpcResponse => r !== null);

    // Only send batch response if there are responses to send
    writeBatchResponse(validResponses);
    return;
  }

  // Handle single request
  const response = await handleSingleRequest(parseResult.request, adapter);
  if (response !== null) {
    process.stdout.write(JSON.stringify(response) + '\n');
  }
}

/**
 * Handle a single JSON-RPC 2.0 request
 * Returns null for notifications (no response expected)
 */
async function handleSingleRequest(
  request: JsonRpcRequest,
  adapter: RPCAdapter
): Promise<JsonRpcResponse | null> {
  const { method, params, id } = request;

  // Notifications don't get responses
  const shouldRespond = !isNotification(request);

  try {
    let result: unknown;

    switch (method) {
      case RPC_METHODS.PROMPT: {
        const promptParams = params as PromptParams | undefined;
        if (!promptParams?.message) {
          if (shouldRespond) {
            return createErrorResponse(
              id!,
              JSON_RPC_ERROR_CODES.INVALID_PARAMS,
              'Missing required parameter: message'
            );
          }
          return null;
        }
        result = await adapter.handlePrompt(id!, promptParams);
        break;
      }

      case RPC_METHODS.ABORT: {
        result = adapter.handleAbort(id!);
        break;
      }

      case RPC_METHODS.RESET: {
        result = adapter.handleReset(id!);
        break;
      }

      case RPC_METHODS.GET_STATE: {
        result = adapter.handleGetState(id!);
        break;
      }

      case RPC_METHODS.GET_MESSAGES: {
        const messagesParams = params as GetMessagesParams | undefined;
        result = adapter.handleGetMessages(id!, messagesParams?.limit);
        break;
      }

      case RPC_METHODS.PERMISSION_RESPONSE: {
        const permParams = params as PermissionResponseParams | undefined;
        if (!permParams?.requestId || permParams?.allowed === undefined) {
          if (shouldRespond) {
            return createErrorResponse(
              id!,
              JSON_RPC_ERROR_CODES.INVALID_PARAMS,
              'Missing required parameters: requestId, allowed'
            );
          }
          return null;
        }
        result = adapter.handlePermissionResponse(id!, permParams.requestId, permParams.allowed);
        break;
      }

      default: {
        if (shouldRespond) {
          return createErrorResponse(
            id!,
            JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
            `Method not found: ${method}`
          );
        }
        return null;
      }
    }

    if (shouldRespond) {
      return createResponse(id!, result);
    }
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (shouldRespond) {
      return createErrorResponse(
        id!,
        JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
        message
      );
    }
    return null;
  }
}

// Export for use in main index.ts
export { RPCAdapter } from './adapter.js';
export * from './types.js';
export * from './protocol.js';
