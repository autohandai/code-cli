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
  McpServer,
  SessionConfigOption,
  SessionModeState,
  SessionModelState,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  ToolCallStatus,
} from '@agentclientprotocol/sdk';
import { PROTOCOL_VERSION, RequestError } from '@agentclientprotocol/sdk';

import { AutohandAgent } from '../../core/agent.js';
import { ConversationManager } from '../../core/conversationManager.js';
import { FileActionManager } from '../../actions/filesystem.js';
import { ProviderFactory } from '../../providers/ProviderFactory.js';
import { loadConfig } from '../../config.js';
import type { AgentOutputEvent, AgentRuntime, CLIOptions, LoadedConfig, LLMToolCall } from '../../types.js';
import type { McpServerConfig } from '../../mcp/types.js';
import { isSessionWorktreeEnabled, prepareSessionWorktree } from '../../utils/sessionWorktree.js';
import { ApiError, classifyApiError, type ApiErrorCode } from '../../providers/errors.js';
import type { SessionMessage } from '../../session/types.js';

import {
  ACP_HOOK_NOTIFICATIONS,
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
  private permissionBridges = new Map<string, ReturnType<typeof createPermissionBridge>>();
  private sessionConfigOptions = new Map<string, SessionConfigOption[]>();
  private cancelledSessions = new Set<string>();
  private config: LoadedConfig | null = null;
  private clientCapabilities?: InitializeRequest['clientCapabilities'];
  private toolStartTimes = new Map<string, number>();
  private static readonly LIST_SESSIONS_PAGE_SIZE = 50;

  constructor(
    private connection: AgentSideConnection,
    private cliOptions: CLIOptions = {}
  ) {}

  private async ensureConfig(): Promise<LoadedConfig> {
    if (!this.config) {
      this.config = await loadConfig();
    }
    return this.config;
  }

  private buildSessionModes(modeId: string): SessionModeState {
    return {
      availableModes: DEFAULT_ACP_MODES.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
      })),
      currentModeId: modeId,
    } as SessionModeState;
  }

  private buildSessionModels(config: LoadedConfig, modelId: string): SessionModelState {
    return {
      availableModels: parseAvailableModels(config).map((m) => ({
        modelId: m,
        name: m.split('/').pop() ?? m,
      })),
      currentModelId: modelId,
    } as SessionModelState;
  }

  private cloneConfigOptions(options: SessionConfigOption[]): SessionConfigOption[] {
    return structuredClone(options);
  }

  private getSessionConfigOptions(sessionId: string): SessionConfigOption[] {
    const options = this.sessionConfigOptions.get(sessionId) ?? [];
    return this.cloneConfigOptions(options);
  }

  private validateMode(modeId: string): void {
    if (!DEFAULT_ACP_MODES.some((mode) => mode.id === modeId)) {
      throw RequestError.invalidParams({ message: `Unsupported mode: ${modeId}` });
    }
  }

  private validateModel(config: LoadedConfig, modelId: string): void {
    const models = parseAvailableModels(config);
    if (!models.includes(modelId)) {
      throw RequestError.invalidParams({ message: `Unsupported model: ${modelId}` });
    }
  }

  private convertAcpMcpServers(mcpServers: McpServer[] | undefined): McpServerConfig[] {
    if (!mcpServers || mcpServers.length === 0) {
      return [];
    }

    return mcpServers.map((server): McpServerConfig => {
      if ('command' in server) {
        return {
          name: server.name,
          transport: 'stdio',
          command: server.command,
          args: [...server.args],
          env: Object.fromEntries(server.env.map((variable: { name: string; value: string }) => [variable.name, variable.value])),
          autoConnect: true,
        };
      }

      return {
        name: server.name,
        transport: server.type,
        url: server.url,
        headers: Object.fromEntries(server.headers.map((header: { name: string; value: string }) => [header.name, header.value])),
        autoConnect: true,
      };
    });
  }

  private async connectSessionMcpServers(agent: AutohandAgent, mcpServers: McpServer[] | undefined): Promise<void> {
    const converted = this.convertAcpMcpServers(mcpServers);
    if (converted.length === 0) {
      return;
    }
    await agent.connectAcpMcpServers(converted);
  }

  private resolveWorkspaceRoot(sessionId: string, cwd: string): string {
    let workspaceRoot = cwd;

    if (isSessionWorktreeEnabled(this.cliOptions.worktree)) {
      const sessionWorktree = prepareSessionWorktree({
        cwd,
        worktree: this.cliOptions.worktree,
        mode: 'acp',
      });
      workspaceRoot = sessionWorktree.worktreePath;
      process.stderr.write(
        `[ACP] Session ${sessionId} using git worktree ${sessionWorktree.worktreePath} (${sessionWorktree.branchName})\n`
      );
    }

    return workspaceRoot;
  }

  private async createManagedSession(
    sessionId: string,
    workspaceRoot: string
  ): Promise<{ config: LoadedConfig; state: AcpSessionState; agent: AutohandAgent }> {
    const config = await this.ensureConfig();

    // Disable Ink renderer for ACP mode
    if (!config.ui) {
      config.ui = {};
    }
    config.ui.useInkRenderer = false;

    const modeId = resolveDefaultMode(config);
    const modelId = resolveDefaultModel(config);

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

    const provider = ProviderFactory.create(config);
    const files = new FileActionManager(workspaceRoot);
    const agent = new AutohandAgent(provider, files, runtime);
    await agent.initializeForRPC();

    const state: AcpSessionState = {
      sessionId,
      modeId,
      modelId,
      workspaceRoot,
      createdAt: Date.now(),
      abortController: new AbortController(),
      promptCount: 0,
    };

    this.sessions.set(sessionId, state);
    this.agents.set(sessionId, agent);
    this.sessionConfigOptions.set(sessionId, buildConfigOptions(config));

    agent.setOutputListener((event: AgentOutputEvent) => {
      this.handleAgentOutput(sessionId, event);
    });

    const permBridge = createPermissionBridge({
      connection: this.connection,
      sessionId,
      modeId,
    });

    agent.setConfirmationCallback(async (message, context) => {
      return permBridge.confirmAction(message, context);
    });
    this.permissionBridges.set(sessionId, permBridge);

    return { config, state, agent };
  }

  private restoreConversation(messages: SessionMessage[]): void {
    const conversation = ConversationManager.getInstance();
    if (!conversation.isInitialized()) {
      throw new Error('Conversation manager is not initialized');
    }

    for (const msg of messages) {
      if (msg.role === 'system') {
        if (!msg.content.startsWith('You are Autohand')) {
          conversation.addSystemNote(msg.content);
        }
        continue;
      }

      let convertedToolCalls: LLMToolCall[] | undefined;
      if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
        convertedToolCalls = msg.toolCalls.map((tc: any) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.tool || tc.function?.name || 'unknown',
            arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args || {}),
          },
        }));
      }

      conversation.addMessage({
        role: msg.role,
        content: msg.content,
        name: msg.name,
        tool_calls: convertedToolCalls,
        tool_call_id: msg.tool_call_id,
      });
    }
  }

  private async replayConversation(sessionId: string, messages: SessionMessage[]): Promise<void> {
    for (const msg of messages) {
      if (!msg.content?.trim()) {
        continue;
      }

      if (msg.role === 'user') {
        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: 'user_message_chunk',
            content: { type: 'text', text: msg.content },
          },
        });
        continue;
      }

      if (msg.role === 'assistant') {
        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: msg.content },
          },
        });
        continue;
      }

      if (msg.role === 'tool') {
        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: `[tool] ${msg.content}` },
          },
        });
        continue;
      }

      if (msg.role === 'system' && !msg.content.startsWith('You are Autohand')) {
        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: `[system] ${msg.content}` },
          },
        });
      }
    }
  }

  private async restoreSession(
    sessionId: string,
    cwd: string,
    mcpServers?: McpServer[]
  ): Promise<{ config: LoadedConfig; state: AcpSessionState; messages: SessionMessage[] }> {
    const workspaceRoot = this.resolveWorkspaceRoot(sessionId, cwd);
    const { config, state, agent } = await this.createManagedSession(sessionId, workspaceRoot);
    await this.connectSessionMcpServers(agent, mcpServers);
    const sessionManager = agent.getSessionManager();

    try {
      const loadedSession = await sessionManager.loadSession(sessionId);
      const messages = loadedSession.getMessages();
      this.restoreConversation(messages);

      if (loadedSession.metadata.model) {
        state.modelId = loadedSession.metadata.model;
      }

      this.sessions.set(sessionId, state);
      return { config, state, messages };
    } catch (error) {
      this.sessions.delete(sessionId);
      this.agents.delete(sessionId);
      this.permissionBridges.delete(sessionId);
      this.sessionConfigOptions.delete(sessionId);
      throw error;
    }
  }

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
        title: 'Autohand Code',
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

    // No token - but we can proceed without auth for local providers
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
    const sessionId = crypto.randomUUID();
    const workspaceRoot = this.resolveWorkspaceRoot(sessionId, params.cwd);
    const { config, state, agent } = await this.createManagedSession(sessionId, workspaceRoot);
    await this.connectSessionMcpServers(agent, params.mcpServers);
    this.emitHookSessionStart(sessionId, 'startup');

    const response: NewSessionResponse = {
      sessionId,
      modes: this.buildSessionModes(state.modeId),
      models: this.buildSessionModels(config, state.modelId),
      configOptions: this.getSessionConfigOptions(sessionId),
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
    this.cancelledSessions.delete(params.sessionId);

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

    // Update session title on first prompt (so Zed shows it in recent sessions)
    session.promptCount++;
    if (session.promptCount === 1) {
      const title = instruction.trim().slice(0, 120);
      this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'session_info_update',
          title,
          updatedAt: new Date().toISOString(),
        },
      });
    } else {
      // Update timestamp on subsequent prompts
      this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'session_info_update',
          updatedAt: new Date().toISOString(),
        },
      });
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

    // Regular instruction - run through the LLM
    const turnStart = Date.now();
    this.emitHookPrePrompt(params.sessionId, instruction, []);
    try {
      const success = await agent.runInstruction(instruction);
      const turnDuration = Date.now() - turnStart;
      this.emitHookStop(params.sessionId, 0, 0, turnDuration);
      if (!success && this.cancelledSessions.has(params.sessionId)) {
        return { stopReason: 'cancelled' };
      }
      return { stopReason: 'end_turn' };
    } catch (err) {
      if (session.abortController.signal.aborted || this.cancelledSessions.has(params.sessionId)) {
        return { stopReason: 'cancelled' };
      }
      const classified = this.classifyAndFormatError(err);
      process.stderr.write(`[ACP] Prompt error (${classified.code}): ${classified.message}\n`);
      this.emitHookSessionError(params.sessionId, classified.message, classified.code);

      await this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: `Error (${classified.code}): ${classified.message}` },
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
    const agent = this.agents.get(params.sessionId);
    if (session) {
      session.abortController.abort();
      this.cancelledSessions.add(params.sessionId);
    }
    if (agent) {
      agent.cancelCurrentInstruction();
    }
  }

  // ==========================================================================
  // ACP Agent Interface: setSessionMode
  // ==========================================================================

  async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
    const session = this.sessions.get(params.sessionId);
    const agent = this.agents.get(params.sessionId);
    if (!session) {
      throw RequestError.invalidParams({ message: 'Session not found' });
    }
    if (!agent) {
      throw RequestError.invalidParams({ message: 'Session agent not found' });
    }

    this.validateMode(params.modeId);

    session.modeId = params.modeId;
    this.permissionBridges.get(params.sessionId)?.setMode(params.modeId);
    agent.applyAcpMode(params.modeId);
    process.stderr.write(`[ACP] Session ${params.sessionId} mode set to: ${params.modeId}\n`);
    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'current_mode_update',
        currentModeId: params.modeId,
      },
    });

    return {};
  }

  // ==========================================================================
  // ACP Agent Interface: unstable_setSessionModel
  // ==========================================================================

  async unstable_setSessionModel(params: SetSessionModelRequest): Promise<SetSessionModelResponse> {
    const session = this.sessions.get(params.sessionId);
    const agent = this.agents.get(params.sessionId);
    if (!session) {
      throw RequestError.invalidParams({ message: 'Session not found' });
    }
    if (!agent) {
      throw RequestError.invalidParams({ message: 'Session agent not found' });
    }
    const config = await this.ensureConfig();
    this.validateModel(config, params.modelId);

    session.modelId = params.modelId;
    agent.applyAcpModel(params.modelId);
    process.stderr.write(`[ACP] Session ${params.sessionId} model set to: ${params.modelId}\n`);
    return {};
  }

  async unstable_setSessionConfigOption(
    params: SetSessionConfigOptionRequest
  ): Promise<SetSessionConfigOptionResponse> {
    const options = this.sessionConfigOptions.get(params.sessionId);
    const agent = this.agents.get(params.sessionId);
    if (!options || !agent) {
      throw RequestError.invalidParams({ message: 'Session not found' });
    }

    const option = options.find((entry) => entry.id === params.configId);
    if (!option) {
      throw RequestError.invalidParams({ message: `Unknown config option: ${params.configId}` });
    }

    const validValues: string[] = [];
    for (const entry of option.options) {
      if ('value' in entry) {
        validValues.push(entry.value);
      } else if ('options' in entry) {
        for (const subEntry of entry.options) {
          validValues.push(subEntry.value);
        }
      }
    }
    if (!validValues.includes(params.value)) {
      throw RequestError.invalidParams({
        message: `Invalid value "${params.value}" for config option "${params.configId}"`,
      });
    }

    option.currentValue = params.value;
    agent.applyAcpConfigOption(params.configId, params.value);

    return {
      configOptions: this.cloneConfigOptions(options),
    };
  }

  // ==========================================================================
  // ACP Agent Interface: unstable_listSessions (optional)
  // ==========================================================================

  async unstable_listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
    // Delegate to SessionManager for persistent session listing
    try {
      const { SessionManager } = await import('../../session/SessionManager.js');
      const sessionManager = new SessionManager();
      await sessionManager.initialize();
      const sessions = await sessionManager.listSessions();
      const filtered = params.cwd
        ? sessions.filter((session) => session.projectPath === params.cwd)
        : sessions;

      const offset = params.cursor ? Number.parseInt(params.cursor, 10) : 0;
      if (Number.isNaN(offset) || offset < 0) {
        throw RequestError.invalidParams({ message: `Invalid cursor: ${params.cursor}` });
      }
      const paged = filtered.slice(offset, offset + AutohandAcpAdapter.LIST_SESSIONS_PAGE_SIZE);
      const nextOffset = offset + paged.length;
      const nextCursor = nextOffset < filtered.length ? String(nextOffset) : undefined;

      return {
        sessions: paged.map((s) => ({
          sessionId: s.sessionId,
          cwd: s.projectPath ?? '',
          title: s.summary ?? s.projectName ?? `Session ${s.sessionId.slice(0, 8)}`,
          updatedAt: s.lastActiveAt ?? s.createdAt,
        })),
        ...(nextCursor ? { nextCursor } : {}),
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
    try {
      const params = _params;
      const { config, state } = await this.restoreSession(params.sessionId, params.cwd, params.mcpServers);

      this.emitHookSessionStart(params.sessionId, 'resume');
      process.stderr.write(`[ACP] Resumed session ${params.sessionId}\n`);
      return {
        modes: this.buildSessionModes(state.modeId),
        models: this.buildSessionModels(config, state.modelId),
        configOptions: this.getSessionConfigOptions(params.sessionId),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw RequestError.invalidParams({ message: `Failed to resume session: ${message}` });
    }
  }

  // ==========================================================================
  // ACP Agent Interface: unstable_forkSession (optional)
  // ==========================================================================

  async unstable_forkSession(params: ForkSessionRequest): Promise<ForkSessionResponse> {
    const sourceSession = this.sessions.get(params.sessionId);
    if (!sourceSession) {
      throw RequestError.invalidParams({ message: 'Source session not found' });
    }

    // Best-effort memory extraction from source session before forking
    const sourceAgent = this.agents.get(params.sessionId);
    if (sourceAgent) {
      try {
        const conversation = ConversationManager.getInstance();
        const { extractAndSaveSessionMemories } = await import('../../memory/extractSessionMemories.js');
        await extractAndSaveSessionMemories({
          llm: sourceAgent.getLlmProvider(),
          memoryManager: sourceAgent.getMemoryManager(),
          conversationHistory: conversation.history(),
          workspaceRoot: sourceSession.workspaceRoot,
        });
      } catch {
        // Memory extraction is best-effort; don't block fork
      }
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
    try {
      const { config, state, messages } = await this.restoreSession(params.sessionId, params.cwd, params.mcpServers);
      await this.replayConversation(params.sessionId, messages);

      this.emitHookSessionStart(params.sessionId, 'resume');
      process.stderr.write(`[ACP] Loaded session ${params.sessionId} with ${messages.length} messages\n`);
      return {
        modes: this.buildSessionModes(state.modeId),
        models: this.buildSessionModels(config, state.modelId),
        configOptions: this.getSessionConfigOptions(params.sessionId),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw RequestError.invalidParams({ message: `Failed to load session: ${message}` });
    }
  }

  // ==========================================================================
  // Hook Lifecycle Notifications
  // ==========================================================================

  /**
   * Safely emit a hook notification via extNotification.
   * Hook notifications must never crash the agent — errors are logged and swallowed.
   */
  private async emitHookSafe(method: string, params: Record<string, unknown>): Promise<void> {
    try {
      await this.connection.extNotification(method, params);
    } catch (err) {
      process.stderr.write(
        `[ACP] Failed to emit hook notification ${method}: ${err instanceof Error ? err.message : String(err)}\n`
      );
    }
  }

  emitHookPreTool(sessionId: string, toolId: string, toolName: string, args: Record<string, unknown>): void {
    void this.emitHookSafe(ACP_HOOK_NOTIFICATIONS.HOOK_PRE_TOOL, {
      sessionId, toolId, toolName, args, timestamp: new Date().toISOString(),
    });
  }

  emitHookPostTool(
    sessionId: string, toolId: string, toolName: string,
    success: boolean, duration: number, output?: string
  ): void {
    void this.emitHookSafe(ACP_HOOK_NOTIFICATIONS.HOOK_POST_TOOL, {
      sessionId, toolId, toolName, success, duration, output, timestamp: new Date().toISOString(),
    });
  }

  emitHookFileModified(sessionId: string, filePath: string, changeType: 'create' | 'modify' | 'delete', toolId: string): void {
    void this.emitHookSafe(ACP_HOOK_NOTIFICATIONS.HOOK_FILE_MODIFIED, {
      sessionId, filePath, changeType, toolId, timestamp: new Date().toISOString(),
    });
  }

  emitHookPrePrompt(sessionId: string, instruction: string, mentionedFiles: string[]): void {
    void this.emitHookSafe(ACP_HOOK_NOTIFICATIONS.HOOK_PRE_PROMPT, {
      sessionId, instruction, mentionedFiles, timestamp: new Date().toISOString(),
    });
  }

  emitHookPostResponse(sessionId: string, tokensUsed: number, toolCallsCount: number, duration: number): void {
    void this.emitHookSafe(ACP_HOOK_NOTIFICATIONS.HOOK_POST_RESPONSE, {
      sessionId, tokensUsed, toolCallsCount, duration, timestamp: new Date().toISOString(),
    });
  }

  emitHookSessionError(sessionId: string, error: string, code?: string, context?: Record<string, unknown>): void {
    void this.emitHookSafe(ACP_HOOK_NOTIFICATIONS.HOOK_SESSION_ERROR, {
      sessionId, error, code, context, timestamp: new Date().toISOString(),
    });
  }

  emitHookStop(sessionId: string, tokensUsed: number, toolCallsCount: number, duration: number): void {
    void this.emitHookSafe(ACP_HOOK_NOTIFICATIONS.HOOK_STOP, {
      sessionId, tokensUsed, toolCallsCount, duration, timestamp: new Date().toISOString(),
    });
  }

  emitHookSessionStart(sessionId: string, sessionType: 'startup' | 'resume' | 'clear'): void {
    void this.emitHookSafe(ACP_HOOK_NOTIFICATIONS.HOOK_SESSION_START, {
      sessionId, sessionType, timestamp: new Date().toISOString(),
    });
  }

  emitHookSessionEnd(sessionId: string, reason: 'quit' | 'clear' | 'exit' | 'error', duration: number): void {
    void this.emitHookSafe(ACP_HOOK_NOTIFICATIONS.HOOK_SESSION_END, {
      sessionId, reason, duration, timestamp: new Date().toISOString(),
    });
  }

  emitHookSubagentStop(
    sessionId: string, subagentId: string, subagentName: string,
    subagentType: string, success: boolean, duration: number, error?: string
  ): void {
    void this.emitHookSafe(ACP_HOOK_NOTIFICATIONS.HOOK_SUBAGENT_STOP, {
      sessionId, subagentId, subagentName, subagentType, success, duration, error, timestamp: new Date().toISOString(),
    });
  }

  emitHookPermissionRequest(
    sessionId: string, tool: string, path?: string, command?: string, args?: Record<string, unknown>
  ): void {
    void this.emitHookSafe(ACP_HOOK_NOTIFICATIONS.HOOK_PERMISSION_REQUEST, {
      sessionId, tool, path, command, args, timestamp: new Date().toISOString(),
    });
  }

  emitHookNotification(sessionId: string, notificationType: string, message: string): void {
    void this.emitHookSafe(ACP_HOOK_NOTIFICATIONS.HOOK_NOTIFICATION, {
      sessionId, notificationType, message, timestamp: new Date().toISOString(),
    });
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

            // Hook: record start time and emit pre-tool notification
            this.toolStartTimes.set(toolCallId, Date.now());
            this.emitHookPreTool(sessionId, toolCallId, event.toolName, event.toolArgs ?? {});
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

            // Hook: compute duration and emit post-tool notification
            const startTime = this.toolStartTimes.get(toolCallId);
            const duration = startTime ? Date.now() - startTime : 0;
            this.toolStartTimes.delete(toolCallId);
            this.emitHookPostTool(
              sessionId, toolCallId, event.toolName,
              event.toolSuccess !== false, duration, event.toolOutput
            );
          }
          break;

        case 'schedule_triggered':
          if (event.content) {
            await this.connection.sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: `[Scheduled job triggered] ${event.content}` },
              },
            });
          }
          break;

        case 'file_modified':
          if (event.filePath) {
            this.emitHookFileModified(
              sessionId,
              event.filePath,
              event.changeType ?? 'modify',
              event.toolId ?? '',
            );
          }
          break;

        case 'error':
          if (event.content) {
            const classified = this.classifyAndFormatError(event.content);
            await this.connection.sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: {
                  type: 'text',
                  text: `Error (${classified.code}): ${classified.message}`,
                },
              },
            });

            // Hook: emit session error notification with classification
            this.emitHookSessionError(sessionId, classified.message, classified.code);
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

  /**
   * Classify an error and return a structured result for ACP consumers.
   * Accepts either an Error instance (including ApiError), a string, or an unknown.
   */
  private classifyAndFormatError(error: unknown): { message: string; code: ApiErrorCode; recoverable: boolean } {
    if (error instanceof ApiError) {
      return {
        message: error.rawDetail || error.message,
        code: error.code,
        recoverable: error.retryable,
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    const classified = classifyApiError(0, message);
    return {
      message,
      code: classified.code,
      recoverable: classified.retryable,
    };
  }
}
