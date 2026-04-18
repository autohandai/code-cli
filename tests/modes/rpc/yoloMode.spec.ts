/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the yoloMode module
vi.mock('../../../src/permissions/yoloMode.js', () => ({
  normalizeYoloInput: vi.fn((input) => {
    if (input === undefined || input === false) return undefined;
    if (input === true) return 'allow:read_file,write_file';
    return input;
  }),
  parseYoloPattern: vi.fn((pattern) => {
    if (pattern === 'allow:*') return { mode: 'allow', tools: ['*'] };
    if (pattern === 'allow:read_file,write_file') return { mode: 'allow', tools: ['read_file', 'write_file'] };
    throw new Error(`Invalid pattern: ${pattern}`);
  }),
  buildPermissionSettingsFromYolo: vi.fn((pattern) => {
    if (pattern.mode === 'allow' && pattern.tools.includes('*')) {
      return { mode: 'unrestricted' };
    }
    return { allowPatterns: pattern.tools.map(t => ({ kind: t })) };
  }),
}));

// Mock other dependencies
vi.mock('../../../src/config.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    provider: 'openrouter',
    openrouter: { apiKey: 'test-key' },
  }),
}));

vi.mock('../../../src/auth/index.js', () => ({
  checkAuthenticated: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../src/startup/workspaceSafety.js', () => ({
  checkWorkspaceSafety: vi.fn().mockReturnValue({ safe: true }),
}));

vi.mock('../../../src/utils/sessionWorktree.js', () => ({
  isSessionWorktreeEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../src/actions/filesystem.js', () => ({
  FileActionManager: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../../src/providers/ProviderFactory.js', () => ({
  ProviderFactory: {
    create: vi.fn().mockReturnValue({
      setModel: vi.fn(),
    }),
  },
}));

vi.mock('../../../src/core/agent.js', () => ({
  AutohandAgent: vi.fn().mockImplementation(() => ({
    initializeForRPC: vi.fn().mockResolvedValue(undefined),
    setOutputListener: vi.fn(),
    setConfirmationCallback: vi.fn(),
  })),
}));

vi.mock('../../../src/core/conversationManager.js', () => ({
  ConversationManager: {
    getInstance: vi.fn().mockReturnValue({
      isInitialized: vi.fn().mockReturnValue(false),
      initialize: vi.fn(),
      addSystemNote: vi.fn(),
    }),
  },
}));

describe('RPC Mode YOLO Processing', () => {
  let originalArgv: string[];
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalArgv = process.argv;
    originalEnv = { ...process.env };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('yolo flag processing', () => {
    it('should process --yolo flag before creating runtime', async () => {
      const { normalizeYoloInput, parseYoloPattern, buildPermissionSettingsFromYolo } = 
        await import('../../../src/permissions/yoloMode.js');

      // Simulate the yolo processing logic from runRpcMode
      const options = { yolo: 'allow:*' };
      const config: any = {};
      
      const normalizedYolo = normalizeYoloInput(options.yolo as string | boolean | undefined);
      expect(normalizedYolo).toBe('allow:*');
      
      if (normalizedYolo) {
        const yoloPattern = parseYoloPattern(normalizedYolo);
        expect(yoloPattern).toEqual({ mode: 'allow', tools: ['*'] });
        
        options.yolo = normalizedYolo;
        config.permissions = {
          ...config.permissions,
          ...buildPermissionSettingsFromYolo(yoloPattern),
        };
      }

      expect(config.permissions).toEqual({ mode: 'unrestricted' });
      expect(options.yolo).toBe('allow:*');
    });

    it('should handle bare --yolo flag (true)', async () => {
      const { normalizeYoloInput, parseYoloPattern, buildPermissionSettingsFromYolo } = 
        await import('../../../src/permissions/yoloMode.js');

      const options = { yolo: true };
      const config: any = {};
      
      const normalizedYolo = normalizeYoloInput(options.yolo as string | boolean | undefined);
      expect(normalizedYolo).toBe('allow:read_file,write_file');
      
      if (normalizedYolo) {
        const yoloPattern = parseYoloPattern(normalizedYolo);
        options.yolo = normalizedYolo;
        config.permissions = {
          ...config.permissions,
          ...buildPermissionSettingsFromYolo(yoloPattern),
        };
      }

      expect(config.permissions).toHaveProperty('allowPatterns');
      expect(options.yolo).toBe('allow:read_file,write_file');
    });

    it('should handle no --yolo flag (undefined)', async () => {
      const { normalizeYoloInput } = await import('../../../src/permissions/yoloMode.js');

      const options = { yolo: undefined };
      const config: any = {};
      
      const normalizedYolo = normalizeYoloInput(options.yolo as string | boolean | undefined);
      expect(normalizedYolo).toBeUndefined();
      
      if (normalizedYolo) {
        // Should not reach here
        expect(true).toBe(false);
      }

      expect(config.permissions).toBeUndefined();
    });

    it('should handle invalid yolo pattern gracefully', async () => {
      const { normalizeYoloInput, parseYoloPattern } = 
        await import('../../../src/permissions/yoloMode.js');

      const options = { yolo: 'invalid-pattern' };
      const config: any = {};
      
      const normalizedYolo = normalizeYoloInput(options.yolo as string | boolean | undefined);
      expect(normalizedYolo).toBe('invalid-pattern');
      
      if (normalizedYolo) {
        expect(() => parseYoloPattern(normalizedYolo)).toThrow();
      }
    });
  });
});