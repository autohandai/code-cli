/**
 * RPC Mode Entry Point
 * JSON-RPC 2.0 server for VS Code extension communication
 * Spec: https://www.jsonrpc.org/specification
 */

import fs from 'fs-extra';
import path from 'node:path';
import { AutohandAgent } from '../../core/agent.js';
import { ConversationManager } from '../../core/conversationManager.js';
import { FileActionManager } from '../../actions/filesystem.js';
import { ProviderFactory } from '../../providers/ProviderFactory.js';
import { loadConfig } from '../../config.js';
import { checkWorkspaceSafety } from '../../startup/workspaceSafety.js';
import type { CLIOptions, AgentRuntime } from '../../types.js';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcId,
  PromptParams,
  GetMessagesParams,
  PermissionResponseParams,
  PermissionAcknowledgedParams,
  ChangesDecisionParams,
  GetSkillsRegistryParams,
  InstallSkillParams,
  AutomodeStartParams,
  AutomodeCancelParams,
  AutomodeGetLogParams,
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

    // Validate and resolve additional directories from --add-dir flag
    const additionalDirs: string[] = [];
    if (options.addDir && options.addDir.length > 0) {
      for (const dir of options.addDir) {
        const resolvedDir = path.resolve(dir);
        if (!await fs.pathExists(resolvedDir)) {
          throw new Error(`Additional directory does not exist: ${dir}`);
        }
        const stats = await fs.stat(resolvedDir);
        if (!stats.isDirectory()) {
          throw new Error(`Additional path is not a directory: ${dir}`);
        }
        const addDirSafetyCheck = checkWorkspaceSafety(resolvedDir);
        if (!addDirSafetyCheck.safe) {
          throw new Error(`Unsafe additional directory: ${dir} - ${addDirSafetyCheck.reason}`);
        }
        additionalDirs.push(resolvedDir);
      }
    }

    // Create runtime - permission mode is handled via RPC, not auto-approve
    const runtime: AgentRuntime = {
      config,
      workspaceRoot,
      options: {
        ...options,
        // Do NOT set yes: true - permissions are handled via RPC
      },
      additionalDirs: additionalDirs.length > 0 ? additionalDirs : undefined,
    };

    // Create LLM provider
    const provider = ProviderFactory.create(config);
    if (options.model) {
      provider.setModel(options.model);
    }

    // Create file action manager
    const files = new FileActionManager(workspaceRoot, additionalDirs);

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

    // Connect agent confirmation to RPC adapter for permission handling
    agent.setConfirmationCallback(async (message, context) => {
      if (!adapter) {
        throw new Error('RPC adapter not initialized');
      }
      const tool = context?.tool ?? 'action';
      const description = message;
      const permContext: { command?: string; path?: string; args?: string[] } = {};
      if (context?.command) permContext.command = context.command;
      if (context?.path) permContext.path = context.path;
      return adapter.requestPermission(tool, description, permContext);
    });

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
  process.stderr.write(`[RPC DEBUG] handleLine received: ${line.slice(0, 100)}\n`);
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
        // Run prompt ASYNCHRONOUSLY so abort can be processed during execution
        // The prompt will write its own response when done
        adapter.handlePrompt(id!, promptParams)
          .then((promptResult) => {
            if (shouldRespond) {
              process.stdout.write(JSON.stringify(createResponse(id!, promptResult)) + '\n');
            }
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            if (shouldRespond) {
              process.stdout.write(JSON.stringify(createErrorResponse(
                id!,
                JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
                message
              )) + '\n');
            }
          });
        // Return null - response will be sent when prompt completes
        return null;
      }

      case RPC_METHODS.ABORT: {
        // Abort can be called as notification (no id) for instant response
        process.stderr.write(`[RPC DEBUG] ABORT received! id=${id}, isNotification=${!shouldRespond}\n`);
        result = adapter.handleAbort(id ?? null);
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

      case RPC_METHODS.PERMISSION_ACKNOWLEDGED: {
        const ackParams = params as PermissionAcknowledgedParams | undefined;
        if (!ackParams?.requestId) {
          if (shouldRespond) {
            return createErrorResponse(
              id!,
              JSON_RPC_ERROR_CODES.INVALID_PARAMS,
              'Missing required parameter: requestId'
            );
          }
          return null;
        }
        result = adapter.handlePermissionAcknowledged(ackParams.requestId);
        break;
      }

      case RPC_METHODS.CHANGES_DECISION: {
        const decisionParams = params as ChangesDecisionParams | undefined;
        if (!decisionParams?.batchId || !decisionParams?.action) {
          if (shouldRespond) {
            return createErrorResponse(
              id!,
              JSON_RPC_ERROR_CODES.INVALID_PARAMS,
              'Missing required parameters: batchId, action'
            );
          }
          return null;
        }
        result = await adapter.handleChangesDecision(id!, decisionParams);
        break;
      }

      case RPC_METHODS.GET_SKILLS_REGISTRY: {
        const registryParams = params as GetSkillsRegistryParams | undefined;
        result = await adapter.handleGetSkillsRegistry(id!, registryParams);
        break;
      }

      case RPC_METHODS.INSTALL_SKILL: {
        const installParams = params as InstallSkillParams | undefined;
        if (!installParams?.skillName || !installParams?.scope) {
          if (shouldRespond) {
            return createErrorResponse(
              id!,
              JSON_RPC_ERROR_CODES.INVALID_PARAMS,
              'Missing required parameters: skillName, scope'
            );
          }
          return null;
        }
        result = await adapter.handleInstallSkill(id!, installParams);
        break;
      }

      // Auto-mode RPC methods
      case RPC_METHODS.AUTOMODE_START: {
        const startParams = params as AutomodeStartParams | undefined;
        if (!startParams?.prompt) {
          if (shouldRespond) {
            return createErrorResponse(
              id!,
              JSON_RPC_ERROR_CODES.INVALID_PARAMS,
              'Missing required parameter: prompt'
            );
          }
          return null;
        }
        result = await adapter.handleAutomodeStart(id!, startParams);
        break;
      }

      case RPC_METHODS.AUTOMODE_STATUS: {
        result = adapter.handleAutomodeStatus(id!);
        break;
      }

      case RPC_METHODS.AUTOMODE_PAUSE: {
        result = await adapter.handleAutomodePause(id!);
        break;
      }

      case RPC_METHODS.AUTOMODE_RESUME: {
        result = await adapter.handleAutomodeResume(id!);
        break;
      }

      case RPC_METHODS.AUTOMODE_CANCEL: {
        const cancelParams = params as AutomodeCancelParams | undefined;
        result = await adapter.handleAutomodeCancel(id!, cancelParams?.reason);
        break;
      }

      case RPC_METHODS.AUTOMODE_GET_LOG: {
        const logParams = params as AutomodeGetLogParams | undefined;
        result = adapter.handleAutomodeGetLog(id!, logParams?.limit);
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
