/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentRuntime } from '../src/types.js';
import type { FileActionManager } from '../src/actions/filesystem.js';
import { ActionExecutor } from '../src/core/actionExecutor.js';

// Mock child_process.execFile for glob tests
const mockExecFile = vi.fn();
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process');
  return {
    ...actual,
    execSync: vi.fn(),
    execFile: (...args: unknown[]) => mockExecFile(...args),
  };
});

// Mock fs-extra
vi.mock('fs-extra', async () => {
  const actual = await vi.importActual('fs-extra');
  return {
    ...actual,
    default: {
      ...(actual as Record<string, unknown>).default,
      pathExists: vi.fn().mockResolvedValue(false),
    },
  };
});

function createRuntime(overrides: Partial<AgentRuntime> = {}): AgentRuntime {
  return {
    config: {
      configPath: '',
      openrouter: { apiKey: 'test', model: 'model' },
    },
    workspaceRoot: '/repo',
    options: {},
    ...overrides,
  } as AgentRuntime;
}

function createFiles(overrides: Partial<FileActionManager> = {}): Partial<FileActionManager> {
  return {
    root: '/repo',
    readFile: vi.fn().mockResolvedValue(''),
    writeFile: vi.fn().mockResolvedValue(undefined),
    appendFile: vi.fn().mockResolvedValue(undefined),
    applyPatch: vi.fn().mockResolvedValue(undefined),
    deletePath: vi.fn().mockResolvedValue(undefined),
    renamePath: vi.fn().mockResolvedValue(undefined),
    copyPath: vi.fn().mockResolvedValue(undefined),
    createDirectory: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockReturnValue([]),
    searchWithContext: vi.fn().mockReturnValue(''),
    semanticSearch: vi.fn().mockReturnValue([]),
    formatFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as Partial<FileActionManager>;
}

function createExecutor(
  filesOverrides: Partial<FileActionManager> = {},
  options: {
    runtime?: Partial<AgentRuntime>;
    confirmDangerousAction?: () => Promise<boolean>;
  } = {},
): ActionExecutor {
  return new ActionExecutor({
    runtime: createRuntime(options.runtime),
    files: createFiles(filesOverrides) as FileActionManager,
    resolveWorkspacePath: (rel) => `/repo/${rel}`,
    confirmDangerousAction: options.confirmDangerousAction ?? vi.fn().mockResolvedValue(true),
  });
}

describe('glob tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('tool definition', () => {
    it('glob is registered in DEFAULT_TOOL_DEFINITIONS', async () => {
      const { DEFAULT_TOOL_DEFINITIONS } = await import('../src/core/toolManager.js');
      const globTool = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'glob');
      expect(globTool).toBeDefined();
      expect(globTool!.parameters!.properties).toHaveProperty('pattern');
      expect(globTool!.parameters!.properties).toHaveProperty('patterns');
      expect(globTool!.parameters!.properties).toHaveProperty('path');
      expect(globTool!.parameters!.properties).toHaveProperty('limit');
    });

    it('glob tool does not require approval', async () => {
      const { DEFAULT_TOOL_DEFINITIONS } = await import('../src/core/toolManager.js');
      const globTool = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'glob');
      expect(globTool!.requiresApproval).toBeFalsy();
    });
  });

  describe('type definition', () => {
    it('glob action type exists in the switch-case of actionExecutor', async () => {
      const { readFileSync } = await import('node:fs');
      const source = readFileSync('src/core/actionExecutor.ts', 'utf-8');
      expect(source).toContain("case 'glob'");
    });
  });

  describe('action execution', () => {
    it('executes glob with single pattern and returns file list', async () => {
      const executor = createExecutor();

      // Mock execFile to simulate rg --files output
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, {
          stdout: '/repo/src/index.ts\n/repo/src/utils.ts\n/repo/src/types.ts\n',
          stderr: '',
        });
      });

      const result = await executor.execute({
        type: 'glob',
        pattern: '*.ts',
      });

      expect(result).toContain('Found 3 files');
      expect(result).toContain('/repo/src/index.ts');
      expect(result).toContain('/repo/src/utils.ts');
      expect(result).toContain('/repo/src/types.ts');
    });

    it('executes glob with multiple patterns', async () => {
      const executor = createExecutor();

      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, {
          stdout: '/repo/src/index.ts\n/repo/src/style.css\n',
          stderr: '',
        });
      });

      const result = await executor.execute({
        type: 'glob',
        patterns: ['*.ts', '*.css'],
      });

      expect(result).toContain('Found 2 files');
    });

    it('defaults to workspace root when no path provided', async () => {
      const executor = createExecutor();

      let capturedArgs: string[] = [];
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
        capturedArgs = args;
        cb(null, { stdout: '', stderr: '' });
      });

      await executor.execute({ type: 'glob', pattern: '*.ts' });

      // The last positional arg should be the workspace root
      expect(capturedArgs[capturedArgs.length - 1]).toBe('/repo');
    });

    it('resolves relative path to workspace root', async () => {
      const executor = createExecutor();

      let capturedArgs: string[] = [];
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
        capturedArgs = args;
        cb(null, { stdout: '', stderr: '' });
      });

      await executor.execute({ type: 'glob', pattern: '*.ts', path: 'src' });

      // Should resolve path relative to workspace root
      expect(capturedArgs[capturedArgs.length - 1]).toBe('/repo/src');
    });

    it('limits results to default of 100', async () => {
      const executor = createExecutor();

      // Generate 150 fake file paths
      const files = Array.from({ length: 150 }, (_, i) => `/repo/file${i}.ts`).join('\n');

      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, { stdout: files, stderr: '' });
      });

      const result = await executor.execute({ type: 'glob', pattern: '*.ts' });

      expect(result).toContain('Found 150 files');
      expect(result).toContain('showing first 100');
      // Verify only 100 files are listed
      const lines = result!.split('\n').filter((l) => l.startsWith('/'));
      expect(lines.length).toBe(100);
    });

    it('respects custom limit parameter', async () => {
      const executor = createExecutor();

      const files = Array.from({ length: 50 }, (_, i) => `/repo/file${i}.ts`).join('\n');

      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, { stdout: files, stderr: '' });
      });

      const result = await executor.execute({ type: 'glob', pattern: '*.ts', limit: 10 });

      expect(result).toContain('Found 50 files');
      expect(result).toContain('showing first 10');
      const lines = result!.split('\n').filter((l) => l.startsWith('/'));
      expect(lines.length).toBe(10);
    });

    it('returns helpful message when no files match', async () => {
      const executor = createExecutor();

      // rg exits with code 1 when no matches found
      const error = new Error('rg exited') as Error & { code: number; stdout: string; stderr: string };
      error.code = 1;
      error.stdout = '';
      error.stderr = '';

      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(error, null);
      });

      const result = await executor.execute({ type: 'glob', pattern: '*.xyz' });

      expect(result).toContain('No files found matching the pattern');
    });

    it('uses --glob flag for each pattern in rg args', async () => {
      const executor = createExecutor();

      let capturedArgs: string[] = [];
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
        capturedArgs = args;
        cb(null, { stdout: '', stderr: '' });
      });

      await executor.execute({ type: 'glob', patterns: ['*.ts', '*.js'] });

      expect(capturedArgs).toContain('--files');
      expect(capturedArgs).toContain('--glob');
      // Should have two --glob flags
      const globIndices = capturedArgs.reduce<number[]>((acc, arg, idx) => {
        if (arg === '--glob') acc.push(idx);
        return acc;
      }, []);
      expect(globIndices.length).toBe(2);
      expect(capturedArgs[globIndices[0] + 1]).toBe('*.ts');
      expect(capturedArgs[globIndices[1] + 1]).toBe('*.js');
    });

    it('defaults pattern to **/* when none provided', async () => {
      const executor = createExecutor();

      let capturedArgs: string[] = [];
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
        capturedArgs = args;
        cb(null, { stdout: '', stderr: '' });
      });

      await executor.execute({ type: 'glob' });

      expect(capturedArgs).toContain('--glob');
      const globIdx = capturedArgs.indexOf('--glob');
      expect(capturedArgs[globIdx + 1]).toBe('**/*');
    });

    it('is allowed in dry-run mode (read-only operation)', async () => {
      const executor = createExecutor({}, {
        runtime: { options: { dryRun: true } },
      });

      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, { stdout: '/repo/src/index.ts\n', stderr: '' });
      });

      const result = await executor.execute({ type: 'glob', pattern: '*.ts' });

      // Should NOT return dry-run skip message
      expect(result).not.toContain('Dry-run mode');
      expect(result).toContain('Found 1 file');
    });
  });

  describe('tool filter integration', () => {
    it('glob is mapped to read category in tool filter', async () => {
      const { readFileSync } = await import('node:fs');
      const source = readFileSync('src/core/toolFilter.ts', 'utf-8');
      expect(source).toContain("glob: 'read'");
    });

    it('glob is mapped to always relevance category', async () => {
      const { readFileSync } = await import('node:fs');
      const source = readFileSync('src/core/toolFilter.ts', 'utf-8');
      expect(source).toContain("glob: 'always'");
    });
  });

  describe('tool output integration', () => {
    it('glob is in the TRUNCATED_TOOLS set', async () => {
      const { readFileSync } = await import('node:fs');
      const source = readFileSync('src/ui/toolOutput.ts', 'utf-8');
      expect(source).toContain("'glob'");
    });
  });
});
