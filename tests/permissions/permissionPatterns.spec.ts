import { describe, it, expect } from 'vitest';
import { PermissionManager } from '../../src/permissions/PermissionManager.js';
import type { PermissionContext } from '../../src/permissions/types.js';

// Helper to make a context quickly
function ctx(tool: string, extra: Partial<PermissionContext> = {}): PermissionContext {
  return { tool, ...extra };
}

describe('PermissionManager – pattern-based checks', () => {
  describe('denyPatterns', () => {
    it('denies when context matches a denyPattern', () => {
      const pm = new PermissionManager({
        settings: {
          denyPatterns: [{ kind: 'run_command', argument: 'git:*' }],
        },
      });
      const decision = pm.checkPermission(ctx('run_command', { command: 'git', args: ['push'] }));
      expect(decision).toMatchObject({ allowed: false, reason: 'pattern_denied' });
    });

    it('does not deny when context does not match any denyPattern', () => {
      const pm = new PermissionManager({
        settings: {
          denyPatterns: [{ kind: 'run_command', argument: 'git:*' }],
        },
      });
      const decision = pm.checkPermission(ctx('run_command', { command: 'npm', args: ['install'] }));
      // Falls through to 'default' (interactive needs prompt)
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('default');
    });

    it('denies by kind-only denyPattern (no argument = matches any target)', () => {
      const pm = new PermissionManager({
        settings: {
          denyPatterns: [{ kind: 'delete_path' }],
        },
      });
      const decision = pm.checkPermission(ctx('delete_path', { path: '/some/file.ts' }));
      expect(decision).toMatchObject({ allowed: false, reason: 'pattern_denied' });
    });
  });

  describe('availableTools', () => {
    it('denies tool not in availableTools list', () => {
      const pm = new PermissionManager({
        settings: {
          availableTools: [{ kind: 'read_file' }, { kind: 'write_file' }],
        },
      });
      const decision = pm.checkPermission(ctx('run_command', { command: 'npm' }));
      expect(decision).toMatchObject({ allowed: false, reason: 'not_in_available' });
    });

    it('allows tool that is in availableTools (continues to normal flow)', () => {
      const pm = new PermissionManager({
        settings: {
          availableTools: [{ kind: 'read_file' }],
          // Also put it on the allowPatterns so it returns allowed
          allowPatterns: [{ kind: 'read_file' }],
        },
      });
      const decision = pm.checkPermission(ctx('read_file', { path: '/src/foo.ts' }));
      expect(decision).toMatchObject({ allowed: true, reason: 'pattern_allowed' });
    });

    it('passes through to default when tool is in availableTools but no further rule matches', () => {
      const pm = new PermissionManager({
        settings: {
          availableTools: [{ kind: 'read_file' }],
        },
      });
      const decision = pm.checkPermission(ctx('read_file', { path: '/src/foo.ts' }));
      // Tool is in available list, not in any allow rule → reaches default
      expect(decision.reason).toBe('default');
    });
  });

  describe('excludedTools', () => {
    it('denies when context matches excludedTools', () => {
      const pm = new PermissionManager({
        settings: {
          excludedTools: [{ kind: 'write_file', argument: 'dist/*' }],
        },
      });
      const decision = pm.checkPermission(ctx('write_file', { path: 'dist/index.js' }));
      expect(decision).toMatchObject({ allowed: false, reason: 'excluded' });
    });

    it('does not deny when excluded pattern does not match', () => {
      const pm = new PermissionManager({
        settings: {
          excludedTools: [{ kind: 'write_file', argument: 'dist/*' }],
        },
      });
      const decision = pm.checkPermission(ctx('write_file', { path: 'src/index.ts' }));
      expect(decision.reason).toBe('default');
    });
  });

  describe('allowPatterns', () => {
    it('allows when context matches an allowPattern', () => {
      const pm = new PermissionManager({
        settings: {
          allowPatterns: [{ kind: 'read_file', argument: 'src/**/*.ts' }],
        },
      });
      const decision = pm.checkPermission(
        ctx('read_file', { path: 'src/permissions/toolPatterns.ts' }),
      );
      expect(decision).toMatchObject({ allowed: true, reason: 'pattern_allowed' });
    });

    it('does not allow when no allowPattern matches', () => {
      const pm = new PermissionManager({
        settings: {
          allowPatterns: [{ kind: 'read_file', argument: 'src/**/*.ts' }],
        },
      });
      const decision = pm.checkPermission(
        ctx('read_file', { path: 'tests/foo.spec.ts' }),
      );
      expect(decision.reason).toBe('default');
    });

    it('denyPatterns take priority over allowPatterns', () => {
      const pm = new PermissionManager({
        settings: {
          denyPatterns: [{ kind: 'run_command' }],
          allowPatterns: [{ kind: 'run_command', argument: 'git:*' }],
        },
      });
      const decision = pm.checkPermission(ctx('run_command', { command: 'git', args: ['status'] }));
      // deny fires first
      expect(decision).toMatchObject({ allowed: false, reason: 'pattern_denied' });
    });
  });

  describe('allPathsAllowed', () => {
    it('allows read_file when allPathsAllowed is true', () => {
      const pm = new PermissionManager({
        settings: { allPathsAllowed: true },
      });
      const decision = pm.checkPermission(ctx('read_file', { path: '/some/file.ts' }));
      expect(decision).toMatchObject({ allowed: true, reason: 'all_paths_allowed' });
    });

    it('allows write_file when allPathsAllowed is true', () => {
      const pm = new PermissionManager({
        settings: { allPathsAllowed: true },
      });
      const decision = pm.checkPermission(ctx('write_file', { path: '/some/output.json' }));
      expect(decision).toMatchObject({ allowed: true, reason: 'all_paths_allowed' });
    });

    it('does not allow run_command when allPathsAllowed is true', () => {
      const pm = new PermissionManager({
        settings: { allPathsAllowed: true },
      });
      const decision = pm.checkPermission(ctx('run_command', { command: 'npm', args: ['test'] }));
      expect(decision.reason).toBe('default');
    });

    it('denyPatterns still block even when allPathsAllowed is true', () => {
      const pm = new PermissionManager({
        settings: {
          allPathsAllowed: true,
          denyPatterns: [{ kind: 'write_file', argument: 'dist/*' }],
        },
      });
      const decision = pm.checkPermission(ctx('write_file', { path: 'dist/bundle.js' }));
      expect(decision).toMatchObject({ allowed: false, reason: 'pattern_denied' });
    });
  });

  describe('allUrlsAllowed', () => {
    it('allows url tool when allUrlsAllowed is true', () => {
      const pm = new PermissionManager({
        settings: { allUrlsAllowed: true },
      });
      const decision = pm.checkPermission(ctx('url', { path: 'https://example.com' }));
      expect(decision).toMatchObject({ allowed: true, reason: 'all_urls_allowed' });
    });

    it('does not allow read_file when only allUrlsAllowed is true', () => {
      const pm = new PermissionManager({
        settings: { allUrlsAllowed: true },
      });
      const decision = pm.checkPermission(ctx('read_file', { path: '/some/file.ts' }));
      expect(decision.reason).toBe('default');
    });
  });

  describe('security blacklist still fires first', () => {
    it('blacklist blocks even when allowPatterns would allow', () => {
      const pm = new PermissionManager({
        settings: {
          allowPatterns: [{ kind: 'read_file' }],
          allPathsAllowed: true,
        },
      });
      // .env is in the security blacklist
      const decision = pm.checkPermission(ctx('read_file', { path: '.env' }));
      expect(decision).toMatchObject({ allowed: false, reason: 'blacklisted' });
    });
  });

  describe('order of pattern checks', () => {
    it('denyPatterns → availableTools → excludedTools → allowPatterns ordering', () => {
      // Tool is in availableTools, not in excludedTools, in allowPatterns
      const pm = new PermissionManager({
        settings: {
          availableTools: [{ kind: 'run_command' }],
          allowPatterns: [{ kind: 'run_command', argument: 'npm:*' }],
        },
      });
      const decision = pm.checkPermission(ctx('run_command', { command: 'npm', args: ['install'] }));
      expect(decision).toMatchObject({ allowed: true, reason: 'pattern_allowed' });
    });

    it('availableTools blocks before excludedTools can fire', () => {
      const pm = new PermissionManager({
        settings: {
          availableTools: [{ kind: 'read_file' }],
          excludedTools: [{ kind: 'run_command' }],
        },
      });
      // run_command is not in availableTools → not_in_available (not 'excluded')
      const decision = pm.checkPermission(ctx('run_command', { command: 'npm' }));
      expect(decision).toMatchObject({ allowed: false, reason: 'not_in_available' });
    });
  });
});
