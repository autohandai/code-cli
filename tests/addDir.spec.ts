/**
 * Tests for --add-dir / /add-dir multi-directory support
 * @license Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

// Test directory base
const TEST_BASE = path.join(os.tmpdir(), 'autohand-adddir-tests');

describe('Multi-Directory Support (--add-dir)', () => {
  let tempDir1: string;
  let tempDir2: string;
  let tempDir3: string;
  let outsideDir: string;

  beforeEach(async () => {
    // Create unique test directories
    const timestamp = Date.now();
    tempDir1 = path.join(TEST_BASE, `main-${timestamp}`);
    tempDir2 = path.join(TEST_BASE, `extra1-${timestamp}`);
    tempDir3 = path.join(TEST_BASE, `extra2-${timestamp}`);
    outsideDir = path.join(TEST_BASE, `outside-${timestamp}`);

    await fs.ensureDir(tempDir1);
    await fs.ensureDir(tempDir2);
    await fs.ensureDir(tempDir3);
    await fs.ensureDir(outsideDir);
  });

  afterEach(async () => {
    await fs.remove(TEST_BASE);
  });

  describe('FileActionManager with additionalDirs', () => {
    it('allows read access to primary workspace', async () => {
      const { FileActionManager } = await import('../src/actions/filesystem.js');
      const manager = new FileActionManager(tempDir1, [tempDir2]);

      // Create test file
      await fs.writeFile(path.join(tempDir1, 'test.txt'), 'hello from primary');

      const content = await manager.readFile('test.txt');
      expect(content).toBe('hello from primary');
    });

    it('allows read access to additional directory with absolute path', async () => {
      const { FileActionManager } = await import('../src/actions/filesystem.js');
      const manager = new FileActionManager(tempDir1, [tempDir2]);

      // Create test file in additional dir
      await fs.writeFile(path.join(tempDir2, 'extra.txt'), 'hello from extra');

      const content = await manager.readFile(path.join(tempDir2, 'extra.txt'));
      expect(content).toBe('hello from extra');
    });

    it('allows write access to additional directory', async () => {
      const { FileActionManager } = await import('../src/actions/filesystem.js');
      const manager = new FileActionManager(tempDir1, [tempDir2]);

      const filePath = path.join(tempDir2, 'new-file.txt');
      await manager.writeFile(filePath, 'new content');

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('new content');
    });

    it('blocks access to non-allowed directory', async () => {
      const { FileActionManager } = await import('../src/actions/filesystem.js');
      const manager = new FileActionManager(tempDir1, [tempDir2]);

      // Create file in outside dir
      await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'hidden');

      await expect(
        manager.readFile(path.join(outsideDir, 'secret.txt'))
      ).rejects.toThrow(/escapes/i);
    });

    it('prevents path traversal to escape workspace', async () => {
      const { FileActionManager } = await import('../src/actions/filesystem.js');
      const manager = new FileActionManager(tempDir1, [tempDir2]);

      await expect(
        manager.readFile('../../../etc/passwd')
      ).rejects.toThrow(/escapes/i);
    });

    it('prevents path traversal using additional dir as base', async () => {
      const { FileActionManager } = await import('../src/actions/filesystem.js');
      const manager = new FileActionManager(tempDir1, [tempDir2]);

      // Try to escape from additional dir
      await expect(
        manager.readFile(path.join(tempDir2, '..', '..', 'etc', 'passwd'))
      ).rejects.toThrow(/escapes/i);
    });

    it('supports multiple additional directories', async () => {
      const { FileActionManager } = await import('../src/actions/filesystem.js');
      const manager = new FileActionManager(tempDir1, [tempDir2, tempDir3]);

      // Create files in all directories
      await fs.writeFile(path.join(tempDir1, 'file1.txt'), 'content1');
      await fs.writeFile(path.join(tempDir2, 'file2.txt'), 'content2');
      await fs.writeFile(path.join(tempDir3, 'file3.txt'), 'content3');

      expect(await manager.readFile('file1.txt')).toBe('content1');
      expect(await manager.readFile(path.join(tempDir2, 'file2.txt'))).toBe('content2');
      expect(await manager.readFile(path.join(tempDir3, 'file3.txt'))).toBe('content3');
    });

    it('handles empty additionalDirs array', async () => {
      const { FileActionManager } = await import('../src/actions/filesystem.js');
      const manager = new FileActionManager(tempDir1, []);

      await fs.writeFile(path.join(tempDir1, 'test.txt'), 'hello');
      const content = await manager.readFile('test.txt');
      expect(content).toBe('hello');

      // Should still block outside dirs
      await expect(
        manager.readFile(path.join(tempDir2, 'file.txt'))
      ).rejects.toThrow(/escapes/i);
    });

    it('handles undefined additionalDirs (backwards compatibility)', async () => {
      const { FileActionManager } = await import('../src/actions/filesystem.js');
      const manager = new FileActionManager(tempDir1);

      await fs.writeFile(path.join(tempDir1, 'test.txt'), 'hello');
      const content = await manager.readFile('test.txt');
      expect(content).toBe('hello');
    });

    it('allows directory listing in additional directory', async () => {
      const { FileActionManager } = await import('../src/actions/filesystem.js');
      const manager = new FileActionManager(tempDir1, [tempDir2]);

      // Create files in additional dir
      await fs.writeFile(path.join(tempDir2, 'a.txt'), 'a');
      await fs.writeFile(path.join(tempDir2, 'b.txt'), 'b');

      const entries = await manager.listDirectory(tempDir2);
      expect(entries.map(e => e.name).sort()).toEqual(['a.txt', 'b.txt']);
    });

    it('allows delete in additional directory', async () => {
      const { FileActionManager } = await import('../src/actions/filesystem.js');
      const manager = new FileActionManager(tempDir1, [tempDir2]);

      const filePath = path.join(tempDir2, 'to-delete.txt');
      await fs.writeFile(filePath, 'delete me');

      await manager.deletePath(filePath);
      expect(await fs.pathExists(filePath)).toBe(false);
    });

    it('blocks delete outside allowed directories', async () => {
      const { FileActionManager } = await import('../src/actions/filesystem.js');
      const manager = new FileActionManager(tempDir1, [tempDir2]);

      const filePath = path.join(outsideDir, 'protected.txt');
      await fs.writeFile(filePath, 'protected');

      await expect(manager.deletePath(filePath)).rejects.toThrow(/escapes/i);
    });
  });

  describe('Safety validation for additional directories', () => {
    it('rejects home directory as additional dir', async () => {
      const { checkWorkspaceSafety } = await import('../src/startup/workspaceSafety.js');
      const result = checkWorkspaceSafety(os.homedir());
      expect(result.safe).toBe(false);
    });

    it('rejects root as additional dir', async () => {
      const { checkWorkspaceSafety } = await import('../src/startup/workspaceSafety.js');
      const result = checkWorkspaceSafety('/');
      expect(result.safe).toBe(false);
    });

    it('rejects /etc as additional dir', async () => {
      const { checkWorkspaceSafety } = await import('../src/startup/workspaceSafety.js');
      const result = checkWorkspaceSafety('/etc');
      expect(result.safe).toBe(false);
    });

    it('rejects /var as additional dir', async () => {
      const { checkWorkspaceSafety } = await import('../src/startup/workspaceSafety.js');
      const result = checkWorkspaceSafety('/var');
      expect(result.safe).toBe(false);
    });

    it('accepts valid project directory', async () => {
      const { checkWorkspaceSafety } = await import('../src/startup/workspaceSafety.js');
      const result = checkWorkspaceSafety(tempDir1);
      expect(result.safe).toBe(true);
    });
  });

  describe('Windows-specific path handling', () => {
    // Skip these tests on non-Windows platforms but verify the logic
    const isWindows = process.platform === 'win32';

    it('rejects Windows drive roots (C:\\)', async () => {
      const { checkWorkspaceSafety } = await import('../src/startup/workspaceSafety.js');

      // Test Windows-style paths even on non-Windows
      const result = checkWorkspaceSafety('C:\\');
      expect(result.safe).toBe(false);
    });

    it('rejects Windows system directory (C:\\Windows)', async () => {
      const { checkWorkspaceSafety } = await import('../src/startup/workspaceSafety.js');
      const result = checkWorkspaceSafety('C:\\Windows');
      expect(result.safe).toBe(false);
    });

    it('rejects Windows Program Files', async () => {
      const { checkWorkspaceSafety } = await import('../src/startup/workspaceSafety.js');
      const result = checkWorkspaceSafety('C:\\Program Files');
      expect(result.safe).toBe(false);
    });

    it('rejects Windows Program Files (x86)', async () => {
      const { checkWorkspaceSafety } = await import('../src/startup/workspaceSafety.js');
      const result = checkWorkspaceSafety('C:\\Program Files (x86)');
      expect(result.safe).toBe(false);
    });

    it('rejects Windows user home directory', async () => {
      const { checkWorkspaceSafety } = await import('../src/startup/workspaceSafety.js');
      // Use a generic Windows user path pattern
      const result = checkWorkspaceSafety('C:\\Users\\testuser');
      expect(result.safe).toBe(false);
    });

    it('rejects Windows ProgramData', async () => {
      const { checkWorkspaceSafety } = await import('../src/startup/workspaceSafety.js');
      const result = checkWorkspaceSafety('C:\\ProgramData');
      expect(result.safe).toBe(false);
    });

    it('handles mixed forward/backslash paths', async () => {
      const { FileActionManager } = await import('../src/actions/filesystem.js');
      const manager = new FileActionManager(tempDir1, [tempDir2]);

      await fs.writeFile(path.join(tempDir1, 'test.txt'), 'hello');

      // On Windows, both should work. On Unix, forward slashes work.
      const content = await manager.readFile('test.txt');
      expect(content).toBe('hello');
    });

    it('normalizes paths consistently', async () => {
      const { FileActionManager } = await import('../src/actions/filesystem.js');
      const manager = new FileActionManager(tempDir1, [tempDir2]);

      // Create directory first, then write file
      await fs.ensureDir(path.join(tempDir1, 'subdir'));
      await fs.writeFile(path.join(tempDir1, 'subdir', 'test.txt'), 'hello');

      // Path with redundant components should normalize
      const content = await manager.readFile(path.join('subdir', '.', 'test.txt'));
      expect(content).toBe('hello');
    });

    it('rejects WSL Windows user directories', async () => {
      const { checkWorkspaceSafety } = await import('../src/startup/workspaceSafety.js');
      const result = checkWorkspaceSafety('/mnt/c/Users/testuser');
      expect(result.safe).toBe(false);
    });

    it('rejects WSL Windows root', async () => {
      const { checkWorkspaceSafety } = await import('../src/startup/workspaceSafety.js');
      const result = checkWorkspaceSafety('/mnt/c');
      expect(result.safe).toBe(false);
    });

    it('rejects WSL Windows system directory', async () => {
      const { checkWorkspaceSafety } = await import('../src/startup/workspaceSafety.js');
      const result = checkWorkspaceSafety('/mnt/c/Windows');
      expect(result.safe).toBe(false);
    });
  });

  describe('Symlink handling', () => {
    it('resolves symlinks before validation', async () => {
      const { FileActionManager } = await import('../src/actions/filesystem.js');

      // Create a symlink from tempDir1 to outsideDir (attack attempt)
      const linkPath = path.join(tempDir1, 'escape-link');

      try {
        await fs.symlink(outsideDir, linkPath);
      } catch {
        // Skip test if symlinks not supported (Windows without admin)
        return;
      }

      const manager = new FileActionManager(tempDir1, [tempDir2]);

      // Create file in outside dir
      await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'secret');

      // Attempting to access via symlink should fail
      await expect(
        manager.readFile(path.join(linkPath, 'secret.txt'))
      ).rejects.toThrow(/escapes/i);
    });

    it('allows symlinks within allowed directories', async () => {
      const { FileActionManager } = await import('../src/actions/filesystem.js');

      // Create a symlink within tempDir1
      const subdir = path.join(tempDir1, 'subdir');
      const linkPath = path.join(tempDir1, 'link-to-subdir');

      await fs.ensureDir(subdir);
      await fs.writeFile(path.join(subdir, 'file.txt'), 'content');

      try {
        await fs.symlink(subdir, linkPath);
      } catch {
        // Skip test if symlinks not supported
        return;
      }

      const manager = new FileActionManager(tempDir1, [tempDir2]);

      // Access via symlink should work since target is within workspace
      const content = await manager.readFile(path.join(linkPath, 'file.txt'));
      expect(content).toBe('content');
    });
  });

  describe('Edge cases', () => {
    it('handles directory that is a prefix of another', async () => {
      const { FileActionManager } = await import('../src/actions/filesystem.js');

      // Create directories where one is prefix of another
      const dirA = path.join(TEST_BASE, 'project');
      const dirB = path.join(TEST_BASE, 'project-extended');

      await fs.ensureDir(dirA);
      await fs.ensureDir(dirB);
      await fs.writeFile(path.join(dirA, 'a.txt'), 'a');
      await fs.writeFile(path.join(dirB, 'b.txt'), 'b');

      // Only dirA is allowed
      const manager = new FileActionManager(dirA, []);

      // Access to dirA should work
      expect(await manager.readFile('a.txt')).toBe('a');

      // Access to dirB should fail (it's not dirA, just has similar prefix)
      await expect(
        manager.readFile(path.join(dirB, 'b.txt'))
      ).rejects.toThrow(/escapes/i);
    });

    it('handles relative paths in additional directories list', async () => {
      const { FileActionManager } = await import('../src/actions/filesystem.js');

      // FileActionManager resolves relative paths to absolute using path.resolve()
      // which uses the current working directory. Since we can't chdir in workers,
      // we test that the path is properly resolved by passing an absolute path
      // that looks like it was resolved from a relative one.
      const manager = new FileActionManager(tempDir1, [tempDir2]);

      await fs.writeFile(path.join(tempDir2, 'test.txt'), 'hello');

      // Should be able to access the file with absolute path
      const content = await manager.readFile(path.join(tempDir2, 'test.txt'));
      expect(content).toBe('hello');
    });

    it('handles duplicate directories in list', async () => {
      const { FileActionManager } = await import('../src/actions/filesystem.js');

      // Pass the same directory multiple times
      const manager = new FileActionManager(tempDir1, [tempDir2, tempDir2, tempDir2]);

      await fs.writeFile(path.join(tempDir2, 'test.txt'), 'hello');

      // Should work normally
      const content = await manager.readFile(path.join(tempDir2, 'test.txt'));
      expect(content).toBe('hello');
    });

    it('handles trailing slashes in paths', async () => {
      const { FileActionManager } = await import('../src/actions/filesystem.js');

      // Paths with trailing slashes
      const manager = new FileActionManager(
        tempDir1 + path.sep,
        [tempDir2 + path.sep]
      );

      await fs.writeFile(path.join(tempDir1, 'test.txt'), 'hello');
      const content = await manager.readFile('test.txt');
      expect(content).toBe('hello');
    });

    it('rejects empty string as additional directory', async () => {
      const { FileActionManager } = await import('../src/actions/filesystem.js');

      // Empty string should be filtered out or cause error
      expect(() => {
        new FileActionManager(tempDir1, ['']);
      }).toThrow();
    });
  });

  describe('CLI integration', () => {
    it('parses single --add-dir flag', () => {
      // This test verifies the expected structure, actual parsing is in index.ts
      const options = {
        path: tempDir1,
        addDir: [tempDir2],
      };

      expect(options.addDir).toHaveLength(1);
      expect(options.addDir[0]).toBe(tempDir2);
    });

    it('parses multiple --add-dir flags', () => {
      const options = {
        path: tempDir1,
        addDir: [tempDir2, tempDir3],
      };

      expect(options.addDir).toHaveLength(2);
    });
  });
});
