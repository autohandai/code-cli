/**
 * Tests for directory permission prompt functionality
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  extractDirectoryPaths,
  isPathOutsideWorkspace,
  type DirectoryPermissionOptions,
} from '../../src/permissions/directoryPermissionPrompt.js';

describe('extractDirectoryPaths', () => {
  it('should extract Unix absolute paths', () => {
    const instruction = 'Look at /Users/foo/bar and /home/user/docs';
    const paths = extractDirectoryPaths(instruction);
    expect(paths).toContain('/Users/foo/bar');
    expect(paths).toContain('/home/user/docs');
  });

  it('should extract Windows absolute paths', () => {
    const instruction = 'Check C:\\Users\\foo\\bar and D:\\Projects\\test';
    const paths = extractDirectoryPaths(instruction);
    expect(paths).toContain('C:\\Users\\foo\\bar');
    expect(paths).toContain('D:\\Projects\\test');
  });

  it('should extract paths with @ prefix', () => {
    const instruction = 'Add @/Users/foo/bar to context';
    const paths = extractDirectoryPaths(instruction);
    expect(paths).toContain('/Users/foo/bar');
  });

  it('should not extract relative paths', () => {
    const instruction = 'Look at ./src and ../docs';
    const paths = extractDirectoryPaths(instruction);
    expect(paths).toHaveLength(0);
  });

  it('should not duplicate paths', () => {
    const instruction = 'Look at /Users/foo/bar and /Users/foo/bar again';
    const paths = extractDirectoryPaths(instruction);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toBe('/Users/foo/bar');
  });

  it('should handle empty instruction', () => {
    const paths = extractDirectoryPaths('');
    expect(paths).toHaveLength(0);
  });

  it('should handle instruction with no paths', () => {
    const paths = extractDirectoryPaths('Just a regular instruction');
    expect(paths).toHaveLength(0);
  });
});

describe('isPathOutsideWorkspace', () => {
  it('should return true for path outside workspace', () => {
    const result = isPathOutsideWorkspace('/Users/other/project', '/Users/foo/bar');
    expect(result).toBe(true);
  });

  it('should return false for path inside workspace', () => {
    const result = isPathOutsideWorkspace('/Users/foo/bar/src', '/Users/foo/bar');
    expect(result).toBe(false);
  });

  it('should return false for workspace root itself', () => {
    const result = isPathOutsideWorkspace('/Users/foo/bar', '/Users/foo/bar');
    expect(result).toBe(false);
  });

  it('should handle relative paths', () => {
    const result = isPathOutsideWorkspace('../other', '/Users/foo/bar');
    expect(result).toBe(true);
  });

  it('should handle Windows paths', () => {
    const result = isPathOutsideWorkspace('D:\\Other\\Project', 'C:\\Users\\foo\\bar');
    expect(result).toBe(true);
  });

  it('should return false for subdirectory of workspace on Windows', () => {
    const result = isPathOutsideWorkspace('C:\\Users\\foo\\bar\\src', 'C:\\Users\\foo\\bar');
    expect(result).toBe(false);
  });
});

describe('DirectoryPermissionOptions interface', () => {
  it('should have required properties', () => {
    const options: DirectoryPermissionOptions = {
      workspaceRoot: '/test/workspace',
      permissionManager: {} as any,
    };
    expect(options.workspaceRoot).toBe('/test/workspace');
    expect(options.permissionManager).toBeDefined();
  });
});
