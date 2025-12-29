/**
 * RPC Mode Entry Point
 * Main entry for JSON-RPC communication with VS Code extension
 */

import { AutohandAgent } from '../../core/agent.js';
import { ConversationManager } from '../../core/conversationManager.js';
import { FileActionManager } from '../../actions/filesystem.js';
import { ProviderFactory } from '../../providers/ProviderFactory.js';
import { loadConfig } from '../../config.js';
import type { CLIOptions, AgentRuntime } from '../../types.js';
import type {
  RPCCommand,
  PromptCommand,
  GetMessagesCommand,
  PermissionResponseCommand,
} from './types.js';
import { RPCAdapter } from './adapter.js';
import {
  LineReader,
  parseCommand,
  writeError,
  writeResponse,
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
 * All output must be JSON-RPC events
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
function restoreConsole(): void {
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.info = originalConsole.info;
  console.debug = originalConsole.debug;
}

/**
 * Run the CLI in RPC mode
 */
export async function runRpcMode(options: CLIOptions): Promise<void> {
  // Suppress console output
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

    // Note: Using yes: true for MVP auto-approve
    // TODO: Implement proper RPC-based permission handling in a future version

    // Setup stdin reader
    const reader = new LineReader(process.stdin);

    // Main command loop
    while (true) {
      try {
        const line = await reader.readLine();
        const command = parseCommand(line);

        if (!command) {
          writeError('PARSE_ERROR', 'Invalid JSON command', true);
          continue;
        }

        await handleCommand(command, adapter);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writeError('COMMAND_ERROR', message, true);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeError('INIT_ERROR', message, false);
    adapter?.shutdown('error');
    process.exit(1);
  }
}

/**
 * Handle an RPC command
 */
async function handleCommand(command: RPCCommand, adapter: RPCAdapter): Promise<void> {
  switch (command.type) {
    case 'prompt': {
      const promptCmd = command as PromptCommand;
      await adapter.handlePrompt(promptCmd);
      break;
    }

    case 'abort': {
      adapter.handleAbort(command.id);
      break;
    }

    case 'reset': {
      adapter.handleReset(command.id);
      break;
    }

    case 'get_state': {
      adapter.handleGetState(command.id);
      break;
    }

    case 'get_messages': {
      const messagesCmd = command as GetMessagesCommand;
      adapter.handleGetMessages(command.id, messagesCmd.limit);
      break;
    }

    case 'permission_response': {
      const permCmd = command as PermissionResponseCommand;
      adapter.handlePermissionResponse(command.id, permCmd.requestId, permCmd.allowed);
      break;
    }

    default: {
      writeResponse(
        command.id,
        command.type,
        false,
        undefined,
        `Unknown command type: ${command.type}`
      );
    }
  }
}

// Export for use in index.ts
export { RPCAdapter } from './adapter.js';
export * from './types.js';
export * from './protocol.js';
