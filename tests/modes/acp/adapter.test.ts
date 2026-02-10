/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AgentSideConnection, InitializeRequest, NewSessionRequest } from '@agentclientprotocol/sdk';
import type { LoadedConfig } from '../../../src/types.js';

// ---------------------------------------------------------------------------
// Hoisted mocks — created before vi.mock hoists
// ---------------------------------------------------------------------------

const {
  mockAgent,
  mockLoadConfig,
  mockProviderCreate,
  mockFileActionManager,
  MockAutohandAgent,
} = vi.hoisted(() => {
  const mockAgent = {
    initializeForRPC: vi.fn().mockResolvedValue(undefined),
    setOutputListener: vi.fn(),
    setConfirmationCallback: vi.fn(),
    runInstruction: vi.fn().mockResolvedValue(true),
    isSlashCommand: vi.fn().mockReturnValue(false),
    isSlashCommandSupported: vi.fn().mockReturnValue(false),
    handleSlashCommand: vi.fn().mockResolvedValue(null),
  };

  // The constructor mock must return the shared mockAgent object
  const MockAutohandAgent = vi.fn().mockImplementation(() => mockAgent);

  const mockLoadConfig = vi.fn<() => Promise<LoadedConfig>>();

  const mockProviderCreate = vi.fn().mockReturnValue({
    getName: () => 'openrouter',
    streamChat: vi.fn(),
  });

  const mockFileActionManager = vi.fn().mockImplementation(() => ({}));

  return { mockAgent, mockLoadConfig, mockProviderCreate, mockFileActionManager, MockAutohandAgent };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../../src/core/agent.js', () => ({
  AutohandAgent: MockAutohandAgent,
}));

vi.mock('../../../src/providers/ProviderFactory.js', () => ({
  ProviderFactory: {
    create: mockProviderCreate,
  },
}));

vi.mock('../../../src/actions/filesystem.js', () => ({
  FileActionManager: mockFileActionManager,
}));

vi.mock('../../../src/config.js', () => ({
  loadConfig: mockLoadConfig,
  resolveWorkspaceRoot: vi.fn().mockReturnValue('/workspace'),
}));

// Mock the package.json import
vi.mock('../../../package.json', () => ({
  default: { version: '0.7.9' },
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import { AutohandAcpAdapter } from '../../../src/modes/acp/adapter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<LoadedConfig> = {}): LoadedConfig {
  return {
    configPath: '/tmp/test-config.json',
    provider: 'openrouter',
    openrouter: {
      apiKey: 'sk-test',
      model: 'anthropic/claude-3.5-sonnet',
    },
    ...overrides,
  } as LoadedConfig;
}

function makeConnection(): AgentSideConnection {
  return {
    requestPermission: vi.fn(),
    sessionUpdate: vi.fn().mockResolvedValue(undefined),
  } as unknown as AgentSideConnection;
}

function makeInitRequest(overrides: Partial<InitializeRequest> = {}): InitializeRequest {
  return {
    protocolVersion: '2025-03-26',
    clientCapabilities: {},
    ...overrides,
  } as InitializeRequest;
}

function makeNewSessionRequest(overrides: Partial<NewSessionRequest> = {}): NewSessionRequest {
  return {
    cwd: '/workspace',
    mcpServers: [],
    ...overrides,
  } as NewSessionRequest;
}

// ===========================================================================
// AutohandAcpAdapter
// ===========================================================================

describe('AutohandAcpAdapter', () => {
  let connection: AgentSideConnection;
  let adapter: AutohandAcpAdapter;
  let config: LoadedConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-establish the constructor mock after clearAllMocks resets it
    MockAutohandAgent.mockImplementation(() => mockAgent);
    mockAgent.initializeForRPC.mockResolvedValue(undefined);
    mockAgent.runInstruction.mockResolvedValue(true);
    mockAgent.isSlashCommand.mockReturnValue(false);
    mockAgent.isSlashCommandSupported.mockReturnValue(false);
    mockAgent.handleSlashCommand.mockResolvedValue(null);

    connection = makeConnection();
    config = makeConfig();
    mockLoadConfig.mockResolvedValue(config);
    adapter = new AutohandAcpAdapter(connection);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // initialize()
  // -------------------------------------------------------------------------

  describe('initialize()', () => {
    it('returns correct protocol version', async () => {
      const result = await adapter.initialize(makeInitRequest());

      expect(result.protocolVersion).toBeDefined();
      // PROTOCOL_VERSION from @agentclientprotocol/sdk can be a number or string
      expect(result.protocolVersion).toBeTruthy();
    });

    it('returns agent capabilities including promptCapabilities', async () => {
      const result = await adapter.initialize(makeInitRequest());

      expect(result.agentCapabilities).toBeDefined();
      expect(result.agentCapabilities.promptCapabilities).toEqual({
        embeddedContext: true,
        image: true,
      });
    });

    it('returns agent capabilities with loadSession support', async () => {
      const result = await adapter.initialize(makeInitRequest());

      expect(result.agentCapabilities.loadSession).toBe(true);
    });

    it('returns agent capabilities with MCP capabilities', async () => {
      const result = await adapter.initialize(makeInitRequest());

      expect(result.agentCapabilities.mcpCapabilities).toEqual({
        http: true,
        sse: true,
      });
    });

    it('returns agent capabilities with session capabilities', async () => {
      const result = await adapter.initialize(makeInitRequest());

      expect(result.agentCapabilities.sessionCapabilities).toEqual({
        list: {},
        resume: {},
        fork: {},
      });
    });

    it('returns correct agent info', async () => {
      const result = await adapter.initialize(makeInitRequest());

      expect(result.agentInfo).toBeDefined();
      expect(result.agentInfo!.name).toBe('autohand-cli');
      expect(result.agentInfo!.title).toBe('Autohand CLI');
      expect(result.agentInfo!.version).toBe('0.7.9');
    });

    it('loads config during initialization', async () => {
      await adapter.initialize(makeInitRequest());

      expect(mockLoadConfig).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // authenticate()
  // -------------------------------------------------------------------------

  describe('authenticate()', () => {
    it('succeeds with valid auth token', async () => {
      const configWithAuth = makeConfig({ auth: { token: 'valid-token' } });
      mockLoadConfig.mockResolvedValue(configWithAuth);

      // Must initialize first to load config
      await adapter.initialize(makeInitRequest());

      const result = await adapter.authenticate({} as any);

      expect(result).toEqual({});
    });

    it('succeeds with provider API key', async () => {
      const configWithKey = makeConfig({
        auth: undefined,
        openrouter: { apiKey: 'sk-or-valid', model: 'anthropic/claude-3.5-sonnet' },
      });
      mockLoadConfig.mockResolvedValue(configWithKey);

      await adapter.initialize(makeInitRequest());

      const result = await adapter.authenticate({} as any);

      expect(result).toEqual({});
    });

    it('throws when no auth available', async () => {
      const configNoAuth = makeConfig({
        auth: undefined,
        provider: 'openrouter',
        openrouter: undefined,
      } as any);
      mockLoadConfig.mockResolvedValue(configNoAuth);

      await adapter.initialize(makeInitRequest());

      await expect(adapter.authenticate({} as any)).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // newSession()
  // -------------------------------------------------------------------------

  describe('newSession()', () => {
    beforeEach(async () => {
      await adapter.initialize(makeInitRequest());
    });

    it('creates session with a valid session ID', async () => {
      const result = await adapter.newSession(makeNewSessionRequest());

      expect(result.sessionId).toBeDefined();
      expect(typeof result.sessionId).toBe('string');
      expect(result.sessionId.length).toBeGreaterThan(0);
    });

    it('returns available modes matching DEFAULT_ACP_MODES', async () => {
      const result = await adapter.newSession(makeNewSessionRequest());

      expect(result.modes).toBeDefined();
      expect(result.modes!.availableModes).toHaveLength(6);

      const modeIds = result.modes!.availableModes.map((m: any) => m.id);
      expect(modeIds).toContain('interactive');
      expect(modeIds).toContain('full-access');
      expect(modeIds).toContain('unrestricted');
      expect(modeIds).toContain('auto-mode');
      expect(modeIds).toContain('restricted');
      expect(modeIds).toContain('dry-run');
    });

    it('returns available models including popular models', async () => {
      const result = await adapter.newSession(makeNewSessionRequest());

      expect(result.models).toBeDefined();
      expect(result.models!.availableModels.length).toBeGreaterThanOrEqual(5);

      const modelIds = result.models!.availableModels.map((m: any) => m.modelId);
      expect(modelIds).toContain('anthropic/claude-3.5-sonnet');
    });

    it('returns config options', async () => {
      const result = await adapter.newSession(makeNewSessionRequest());

      expect(result.configOptions).toBeDefined();
      expect(result.configOptions!.length).toBe(3);

      const configIds = result.configOptions!.map((o) => o.id);
      expect(configIds).toContain('thinking_level');
      expect(configIds).toContain('auto_commit');
      expect(configIds).toContain('context_compact');
    });

    it('returns commands in _meta matching DEFAULT_ACP_COMMANDS', async () => {
      const result = await adapter.newSession(makeNewSessionRequest());

      expect(result._meta).toBeDefined();
      expect(result._meta!.commands).toBeDefined();
      const commands = result._meta!.commands as Array<{ name: string; description: string }>;
      expect(commands).toHaveLength(24);

      const cmdNames = commands.map((c) => c.name);
      expect(cmdNames).toContain('help');
      expect(cmdNames).toContain('model');
      expect(cmdNames).toContain('undo');
    });

    it('initializes agent for RPC mode', async () => {
      await adapter.newSession(makeNewSessionRequest());

      expect(mockAgent.initializeForRPC).toHaveBeenCalledTimes(1);
    });

    it('sets output listener on the agent', async () => {
      await adapter.newSession(makeNewSessionRequest());

      expect(mockAgent.setOutputListener).toHaveBeenCalledTimes(1);
      expect(typeof mockAgent.setOutputListener.mock.calls[0][0]).toBe('function');
    });

    it('sets confirmation callback on the agent', async () => {
      await adapter.newSession(makeNewSessionRequest());

      expect(mockAgent.setConfirmationCallback).toHaveBeenCalledTimes(1);
      expect(typeof mockAgent.setConfirmationCallback.mock.calls[0][0]).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // prompt()
  // -------------------------------------------------------------------------

  describe('prompt()', () => {
    let sessionId: string;

    beforeEach(async () => {
      await adapter.initialize(makeInitRequest());
      const session = await adapter.newSession(makeNewSessionRequest());
      sessionId = session.sessionId;
    });

    it('handles empty instruction (returns end_turn)', async () => {
      const result = await adapter.prompt({
        sessionId,
        prompt: [{ type: 'text', text: '   ' }],
      } as any);

      expect(result.stopReason).toBe('end_turn');
      expect(mockAgent.runInstruction).not.toHaveBeenCalled();
    });

    it('handles empty prompt array (returns end_turn)', async () => {
      const result = await adapter.prompt({
        sessionId,
        prompt: [],
      } as any);

      expect(result.stopReason).toBe('end_turn');
      expect(mockAgent.runInstruction).not.toHaveBeenCalled();
    });

    it('handles slash commands', async () => {
      mockAgent.isSlashCommand.mockReturnValue(true);
      mockAgent.isSlashCommandSupported.mockReturnValue(true);
      mockAgent.handleSlashCommand.mockResolvedValue('Help output here');

      const result = await adapter.prompt({
        sessionId,
        prompt: [{ type: 'text', text: '/help' }],
      } as any);

      expect(result.stopReason).toBe('end_turn');
      expect(mockAgent.isSlashCommand).toHaveBeenCalledWith('/help');
      expect(mockAgent.handleSlashCommand).toHaveBeenCalledWith('help', []);
      expect(connection.sessionUpdate).toHaveBeenCalled();
    });

    it('calls agent.runInstruction for regular prompts', async () => {
      mockAgent.isSlashCommand.mockReturnValue(false);
      mockAgent.runInstruction.mockResolvedValue(true);

      const result = await adapter.prompt({
        sessionId,
        prompt: [{ type: 'text', text: 'Add unit tests for the auth module' }],
      } as any);

      expect(result.stopReason).toBe('end_turn');
      expect(mockAgent.runInstruction).toHaveBeenCalledWith('Add unit tests for the auth module');
    });

    it('throws for invalid session ID', async () => {
      await expect(
        adapter.prompt({
          sessionId: 'nonexistent-session',
          prompt: [{ type: 'text', text: 'hello' }],
        } as any)
      ).rejects.toThrow();
    });

    it('handles runInstruction errors gracefully', async () => {
      mockAgent.isSlashCommand.mockReturnValue(false);
      mockAgent.runInstruction.mockRejectedValue(new Error('LLM request failed'));

      // Suppress stderr
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      const result = await adapter.prompt({
        sessionId,
        prompt: [{ type: 'text', text: 'Do something' }],
      } as any);

      expect(result.stopReason).toBe('end_turn');
      expect(connection.sessionUpdate).toHaveBeenCalled();

      stderrSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // cancel()
  // -------------------------------------------------------------------------

  describe('cancel()', () => {
    it('aborts the session abort controller', async () => {
      await adapter.initialize(makeInitRequest());
      const session = await adapter.newSession(makeNewSessionRequest());

      // cancel() should complete without error
      await adapter.cancel({ sessionId: session.sessionId });
    });

    it('does nothing for non-existent session', async () => {
      await adapter.initialize(makeInitRequest());

      // Should not throw for a session that does not exist
      await adapter.cancel({ sessionId: 'nonexistent' });
    });
  });

  // -------------------------------------------------------------------------
  // setSessionMode()
  // -------------------------------------------------------------------------

  describe('setSessionMode()', () => {
    it('updates session mode', async () => {
      await adapter.initialize(makeInitRequest());
      const session = await adapter.newSession(makeNewSessionRequest());

      // Suppress stderr from mode change log
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      const result = await adapter.setSessionMode({
        sessionId: session.sessionId,
        mode: 'unrestricted',
      } as any);

      expect(result).toEqual({});

      stderrSpy.mockRestore();
    });

    it('throws for non-existent session', async () => {
      await adapter.initialize(makeInitRequest());

      await expect(
        adapter.setSessionMode({
          sessionId: 'nonexistent',
          mode: 'unrestricted',
        } as any)
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // unstable_setSessionModel()
  // -------------------------------------------------------------------------

  describe('unstable_setSessionModel()', () => {
    it('updates session model', async () => {
      await adapter.initialize(makeInitRequest());
      const session = await adapter.newSession(makeNewSessionRequest());

      // Suppress stderr from model change log
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      const result = await adapter.unstable_setSessionModel({
        sessionId: session.sessionId,
        modelId: 'openai/gpt-4o',
      } as any);

      expect(result).toEqual({});

      stderrSpy.mockRestore();
    });

    it('throws for non-existent session', async () => {
      await adapter.initialize(makeInitRequest());

      await expect(
        adapter.unstable_setSessionModel({
          sessionId: 'nonexistent',
          modelId: 'openai/gpt-4o',
        } as any)
      ).rejects.toThrow();
    });
  });
});
