/**
 * ACP Adapter
 * Core adapter implementing the ACP Agent interface in-process.
 * Replaces the external subprocess-based adapter for direct Zed integration.
 */

import type {
  Agent,
  AgentSideConnection,
  AuthenticateRequest,
  AuthenticateResponse,
  CancelNotification,
  InitializeRequest,
  InitializeResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  SetSessionModeRequest,
  SetSessionModeResponse,
  SetSessionModelRequest,
  SetSessionModelResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  ResumeSessionRequest,
  ResumeSessionResponse,
  ForkSessionRequest,
  ForkSessionResponse,
  SessionModeState,
  SessionModelState,
  ModelInfo,
  SessionMode,
  ToolCallStatus,
} from '@agentclientprotocol/sdk';
import { PROTOCOL_VERSION, RequestError } from '@agentclientprotocol/sdk';

import { AutohandAgent } from '../../core/agent.js';
import { FileActionManager } from '../../actions/filesystem.js';
import { ProviderFactory } from '../../providers/ProviderFactory.js';
import { loadConfig } from '../../config.js';
import type { AgentOutputEvent, AgentRuntime, LoadedConfig } from '../../types.js';

import {
  DEFAULT_ACP_COMMANDS,
  DEFAULT_ACP_MODES,
  type AcpSessionState,
  buildConfigOptions,
  parseAvailableModels,
  resolveDefaultMode,
  resolveDefaultModel,
  resolveToolKind,
  resolveToolDisplayName,
} from './types.js';
import { createPermissionBridge } from './permissions.js';

import packageJson from '../../../package.json' with { type: 'json' };

/**
 * AutohandAcpAdapter implements the ACP Agent interface.
 * All agent interaction happens in-process (no subprocess spawning).
 */
export class AutohandAcpAdapter implements Agent {
  private sessions = new Map<string, AcpSessionState>();
  private agents = new Map<string, AutohandAgent>();
  private config: LoadedConfig | null = null;
  private clientCapabilities?: InitializeRequest['clientCapabilities'];

  constructor(private connection: AgentSideConnection) {}

  // ==========================================================================
  // ACP Agent Interface: initialize
  // ==========================================================================

  async initialize(params: InitializeRequest): Promise<InitializeResponse> {
    this.clientCapabilities = params.clientCapabilities;

    // Load config once for the lifetime of the connection
    this.config = await loadConfig();

    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        promptCapabilities: {
          embeddedContext: true,
          image: true,
        },
        loadSession: true,
        mcpCapabilities: {
          http: true,
          sse: true,
        },
        sessionCapabilities: {
          list: {},
          resume: {},
          fork: {},
        },
      },
      agentInfo: {
        name: 'autohand-cli',
        title: 'Autohand CLI',
        version: packageJson.version,
      },
    };
  }

  // ==========================================================================
  // ACP Agent Interface: authenticate
  // ==========================================================================

  async authenticate(_params: AuthenticateRequest): Promise<AuthenticateResponse> {
    // In native mode, authentication is handled by the CLI config.
    // If the config has valid auth, we're good.
    if (this.config?.auth?.token) {
      return {};
    }

    // No token — but we can proceed without auth for local providers
    const provider = this.config?.provider ?? 'openrouter';
    const providerConfig = (this.config as Record<string, any>)?.[provider];
    if (providerConfig?.apiKey) {
      return {};
    }

    throw RequestError.authRequired({
      message: 'Please run `autohand --setup` or `autohand login` in your terminal.',
    });
  }

  // ==========================================================================
  // ACP Agent Interface: newSession
  // ==========================================================================

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    if (!this.config) {
      this.config = await loadConfig();
    }

    const config = this.config;
    const workspaceRoot = params.cwd;

    // Create runtime
    const modeId = resolveDefaultMode(config);
    const runtime: AgentRuntime = {
      config,
      workspaceRoot,
      options: {
        yes: modeId === 'unrestricted' || modeId === 'full-access',
        unrestricted: modeId === 'unrestricted',
        restricted: modeId === 'restricted',
        dryRun: modeId === 'dry-run',
      },
      isRpcMode: true,
    };

    // Disable Ink renderer for ACP mode
    if (!config.ui) {
      config.ui = {};
    }
    config.ui.useInkRenderer = false;

    // Create provider and file manager
    const provider = ProviderFactory.create(config);
    const files = new FileActionManager(workspaceRoot);

    // Create agent
    const agent = new AutohandAgent(provider, files, runtime);
    await agent.initializeForRPC();

    // Generate session ID
    const sessionId = crypto.randomUUID();

    // Create abort controller for this session
    const abortController = new AbortController();

    // Store session state
    const modelId = resolveDefaultModel(config);
    const sessionState: AcpSessionState = {
      sessionId,
      modeId,
      modelId,
      workspaceRoot,
      createdAt: Date.now(),
      abortController,
    };
    this.sessions.set(sessionId, sessionState);
    this.agents.set(sessionId, agent);

    // Wire output listener to emit ACP session updates
    agent.setOutputListener((event: AgentOutputEvent) => {
      this.handleAgentOutput(sessionId, event);
    });

    // Wire permission bridge
    const permBridge = createPermissionBridge({
      connection: this.connection,
      sessionId,
      modeId,
    });

    agent.setConfirmationCallback(async (message, context) => {
      return permBridge.confirmAction(message, context);
    });

    // Build response matching external adapter format
    const availableModes: SessionMode[] = DEFAULT_ACP_MODES.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
    }));

    const availableModels: ModelInfo[] = parseAvailableModels(config).map((m) => ({
      modelId: m,
      name: m.split('/').pop() ?? m,
    }));

    const configOptions = buildConfigOptions(config);

    const response: NewSessionResponse = {
      sessionId,
      modes: {
        availableModes,
        currentModeId: modeId,
      } as SessionModeState,
      models: {
        availableModels,
        currentModelId: modelId,
      } as SessionModelState,
      configOptions,
      _meta: {
        commands: DEFAULT_ACP_COMMANDS.map((cmd) => ({
          name: cmd.name,
          description: cmd.description,
        })),
      },
    };

    return response;
  }

  // ==========================================================================
  // ACP Agent Interface: prompt
  // ==========================================================================

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    const agent = this.agents.get(params.sessionId);

    if (!session || !agent) {
      throw RequestError.invalidParams({ message: 'Session not found' });
    }

    // Reset cancellation state
    session.abortController = new AbortController();

    // Resolve prompt text from content blocks
    let instruction = '';
    if (params.prompt) {
      for (const block of params.prompt) {
        if (block.type === 'text') {
          instruction += block.text;
        } else if (block.type === 'resource') {
          // Append resource URI context
          const resourceUri = (block as any).resource?.uri ?? '';
          instruction += `\n[Resource: ${resourceUri}]`;
        }
      }
    }

    if (!instruction.trim()) {
      return { stopReason: 'end_turn' };
    }

    // Check if it's a slash command
    const trimmed = instruction.trim();
    if (trimmed.startsWith('/')) {
      // Use parseSlashCommand to handle two-word commands ("/mcp install", "/skills new")
      // and preserve the "/" prefix required by the handler.
      const { command, args } = agent.parseSlashCommand(trimmed);

      if (agent.isSlashCommand(trimmed)) {
        try {
          if (agent.isSlashCommandSupported(command)) {
            const result = await agent.handleSlashCommand(command, args);
            if (result !== null) {
              await this.connection.sessionUpdate({
                sessionId: params.sessionId,
                update: {
                  sessionUpdate: 'agent_message_chunk',
                  content: { type: 'text', text: result },
                },
              });
            } else {
              await this.connection.sessionUpdate({
                sessionId: params.sessionId,
                update: {
                  sessionUpdate: 'agent_message_chunk',
                  content: { type: 'text', text: `Command ${command} executed.` },
                },
              });
            }
          } else {
            await this.connection.sessionUpdate({
              sessionId: params.sessionId,
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: `Unknown command: ${command}. Type /help for available commands.` },
              },
            });
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          await this.connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: `Error: ${errMsg}` },
            },
          });
        }
        return { stopReason: 'end_turn' };
      }
    }

    // Regular instruction — run through the LLM
    try {
      const success = await agent.runInstruction(instruction);
      return { stopReason: success ? 'end_turn' : 'end_turn' };
    } catch (err) {
      if (session.abortController.signal.aborted) {
        return { stopReason: 'cancelled' };
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ACP] Prompt error: ${errMsg}\n`);

      await this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: `Error: ${errMsg}` },
        },
      });
      return { stopReason: 'end_turn' };
    }
  }

  // ==========================================================================
  // ACP Agent Interface: cancel
  // ==========================================================================

  async cancel(params: CancelNotification): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    if (session) {
      session.abortController.abort();
    }
  }

  // ==========================================================================
  // ACP Agent Interface: setSessionMode
  // ==========================================================================

  async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw RequestError.invalidParams({ message: 'Session not found' });
    }

    session.modeId = params.modeId;
    process.stderr.write(`[ACP] Session ${params.sessionId} mode set to: ${params.modeId}\n`);

    return {};
  }

  // ==========================================================================
  // ACP Agent Interface: unstable_setSessionModel
  // ==========================================================================

  async unstable_setSessionModel(params: SetSessionModelRequest): Promise<SetSessionModelResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw RequestError.invalidParams({ message: 'Session not found' });
    }

    session.modelId = params.modelId;
    process.stderr.write(`[ACP] Session ${params.sessionId} model set to: ${params.modelId}\n`);

    // Update the provider model for the agent
    // The agent's provider is internal but we can access it through config
    // For now, we just update the session state. Full implementation would
    // call provider.setModel().
    return {};
  }

  // ==========================================================================
  // ACP Agent Interface: unstable_listSessions (optional)
  // ==========================================================================

  async unstable_listSessions(_params: ListSessionsRequest): Promise<ListSessionsResponse> {
    // Delegate to SessionManager for persistent session listing
    try {
      const { SessionManager } = await import('../../session/SessionManager.js');
      const sessionManager = new SessionManager();
      await sessionManager.initialize();
      const sessions = await sessionManager.listSessions();

      return {
        sessions: sessions.map((s) => ({
          sessionId: s.sessionId,
          cwd: s.projectPath ?? '',
          title: s.summary ?? s.projectName ?? `Session ${s.sessionId.slice(0, 8)}`,
          updatedAt: s.lastActiveAt ?? s.createdAt,
        })),
      };
    } catch (err) {
      process.stderr.write(`[ACP] Failed to list sessions: ${err instanceof Error ? err.message : String(err)}\n`);
      return { sessions: [] };
    }
  }

  // ==========================================================================
  // ACP Agent Interface: unstable_resumeSession (optional)
  // ==========================================================================

  async unstable_resumeSession(_params: ResumeSessionRequest): Promise<ResumeSessionResponse> {
    // For resume, we create a new agent and load the session
    if (!this.config) {
      this.config = await loadConfig();
    }

    // TODO: implement full session resume with conversation history
    // For now, return an empty response to signal resume is supported
    return {};
  }

  // ==========================================================================
  // ACP Agent Interface: unstable_forkSession (optional)
  // ==========================================================================

  async unstable_forkSession(params: ForkSessionRequest): Promise<ForkSessionResponse> {
    const sourceSession = this.sessions.get(params.sessionId);
    if (!sourceSession) {
      throw RequestError.invalidParams({ message: 'Source session not found' });
    }

    // Create a new session based on the source
    // For now, create a fresh session at the same workspace
    const newSessionResponse = await this.newSession({
      cwd: sourceSession.workspaceRoot,
      mcpServers: [],
    });

    return {
      sessionId: newSessionResponse.sessionId,
    };
  }

  // ==========================================================================
  // ACP Agent Interface: loadSession (optional)
  // ==========================================================================

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    // Load a session and replay its history as notifications
    // TODO: implement full session loading with conversation replay
    const session = this.sessions.get(params.sessionId);

    return {
      modes: session ? {
        availableModes: DEFAULT_ACP_MODES.map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
        })),
        currentModeId: session.modeId,
      } as SessionModeState : undefined,
    };
  }

  // ==========================================================================
  // Agent Output → ACP Session Updates
  // ==========================================================================

  /**
   * Translates AutohandAgent output events into ACP session update notifications.
   * This is the core bridge between the agent's internal event system and the ACP protocol.
   */
  private async handleAgentOutput(sessionId: string, event: AgentOutputEvent): Promise<void> {
    try {
      switch (event.type) {
        case 'thinking':
          if (event.thought) {
            await this.connection.sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: {
                  type: 'thinking',
                  text: event.thought,
                },
              },
            });
          }
          break;

        case 'message':
          if (event.content) {
            await this.connection.sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: {
                  type: 'text',
                  text: event.content,
                },
              },
            });
          }
          break;

        case 'tool_start':
          if (event.toolName) {
            const toolCallId = event.toolId ?? `tool_${Date.now()}`;
            const kind = resolveToolKind(event.toolName);
            const title = resolveToolDisplayName(event.toolName);

            // Build locations from tool args
            const locations: Array<{ path: string }> = [];
            if (event.toolArgs?.path && typeof event.toolArgs.path === 'string') {
              locations.push({ path: event.toolArgs.path });
            }
            if (event.toolArgs?.file && typeof event.toolArgs.file === 'string') {
              locations.push({ path: event.toolArgs.file });
            }

            await this.connection.sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: 'tool_call',
                toolCallId,
                title,
                kind,
                status: 'in_progress' as ToolCallStatus,
                locations,
                rawInput: event.toolArgs ?? {},
              },
            });
          }
          break;

        case 'tool_end':
          if (event.toolName) {
            const toolCallId = event.toolId ?? 'unknown';
            const status: ToolCallStatus = event.toolSuccess !== false ? 'completed' : 'failed';

            await this.connection.sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: 'tool_call_update',
                toolCallId,
                status,
                rawOutput: event.toolOutput
                  ? { output: event.toolOutput }
                  : undefined,
              },
            });
          }
          break;

        case 'error':
          if (event.content) {
            await this.connection.sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: {
                  type: 'text',
                  text: `Error: ${event.content}`,
                },
              },
            });
          }
          break;
      }
    } catch (err) {
      // Don't let notification errors crash the agent
      process.stderr.write(
        `[ACP] Failed to send session update: ${err instanceof Error ? err.message : String(err)}\n`
      );
    }
  }
}
