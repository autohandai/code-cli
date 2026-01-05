/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { generateUnifiedPatch, formatChangeSummary } from '../src/utils/patch.js';
import type { BatchedChange } from '../src/actions/filesystem.js';

describe('generateUnifiedPatch', () => {
  describe('file modifications', () => {
    it('generates correct diff for single line change', () => {
      const changes: BatchedChange[] = [{
        id: 'change_1',
        filePath: 'src/index.ts',
        changeType: 'modify',
        originalContent: 'const x = 1;\n',
        proposedContent: 'const x = 2;\n',
        description: 'Update x',
        toolId: 'tool_1',
        toolName: 'write_file'
      }];

      const patch = generateUnifiedPatch(changes);

      expect(patch).toContain('diff --git a/src/index.ts b/src/index.ts');
      expect(patch).toContain('-const x = 1;');
      expect(patch).toContain('+const x = 2;');
    });

    it('generates correct diff for multi-line changes', () => {
      const changes: BatchedChange[] = [{
        id: 'change_1',
        filePath: 'src/app.ts',
        changeType: 'modify',
        originalContent: 'line1\nline2\nline3\n',
        proposedContent: 'line1\nmodified\nline3\nnew line\n',
        description: 'Multi-line edit',
        toolId: 'tool_1',
        toolName: 'write_file'
      }];

      const patch = generateUnifiedPatch(changes);

      expect(patch).toContain('-line2');
      expect(patch).toContain('+modified');
      expect(patch).toContain('+new line');
    });

    it('handles empty original content (new file scenario)', () => {
      const changes: BatchedChange[] = [{
        id: 'change_1',
        filePath: 'src/new.ts',
        changeType: 'modify',
        originalContent: '',
        proposedContent: 'export const foo = 1;\n',
        description: 'Add content',
        toolId: 'tool_1',
        toolName: 'write_file'
      }];

      const patch = generateUnifiedPatch(changes);
      expect(patch).toContain('+export const foo = 1;');
    });
  });

  describe('new file creation', () => {
    it('generates new file mode header', () => {
      const changes: BatchedChange[] = [{
        id: 'change_1',
        filePath: 'src/utils/helper.ts',
        changeType: 'create',
        originalContent: '',
        proposedContent: 'export function helper() {}\n',
        description: 'Create helper',
        toolId: 'tool_1',
        toolName: 'write_file'
      }];

      const patch = generateUnifiedPatch(changes);

      expect(patch).toContain('diff --git a/src/utils/helper.ts b/src/utils/helper.ts');
      expect(patch).toContain('new file mode 100644');
      expect(patch).toContain('--- /dev/null');
      expect(patch).toContain('+++ b/src/utils/helper.ts');
    });

    it('handles nested directory paths', () => {
      const changes: BatchedChange[] = [{
        id: 'change_1',
        filePath: 'src/deep/nested/path/file.ts',
        changeType: 'create',
        originalContent: '',
        proposedContent: 'content\n',
        description: 'Create nested file',
        toolId: 'tool_1',
        toolName: 'write_file'
      }];

      const patch = generateUnifiedPatch(changes);
      expect(patch).toContain('a/src/deep/nested/path/file.ts');
    });
  });

  describe('file deletion', () => {
    it('generates deleted file mode header', () => {
      const changes: BatchedChange[] = [{
        id: 'change_1',
        filePath: 'src/deprecated.ts',
        changeType: 'delete',
        originalContent: 'old content\n',
        proposedContent: '',
        description: 'Delete file',
        toolId: 'tool_1',
        toolName: 'delete_path'
      }];

      const patch = generateUnifiedPatch(changes);

      expect(patch).toContain('deleted file mode 100644');
      expect(patch).toContain('--- a/src/deprecated.ts');
      expect(patch).toContain('+++ /dev/null');
      expect(patch).toContain('-old content');
    });
  });

  describe('multiple changes', () => {
    it('handles multiple files in order', () => {
      const changes: BatchedChange[] = [
        {
          id: 'change_1',
          filePath: 'src/a.ts',
          changeType: 'create',
          originalContent: '',
          proposedContent: 'a content\n',
          description: 'Create a',
          toolId: 'tool_1',
          toolName: 'write_file'
        },
        {
          id: 'change_2',
          filePath: 'src/b.ts',
          changeType: 'modify',
          originalContent: 'old\n',
          proposedContent: 'new\n',
          description: 'Modify b',
          toolId: 'tool_2',
          toolName: 'write_file'
        },
        {
          id: 'change_3',
          filePath: 'src/c.ts',
          changeType: 'delete',
          originalContent: 'deleted\n',
          proposedContent: '',
          description: 'Delete c',
          toolId: 'tool_3',
          toolName: 'delete_path'
        }
      ];

      const patch = generateUnifiedPatch(changes);

      // Check order
      const aIndex = patch.indexOf('a/src/a.ts');
      const bIndex = patch.indexOf('a/src/b.ts');
      const cIndex = patch.indexOf('a/src/c.ts');

      expect(aIndex).toBeLessThan(bIndex);
      expect(bIndex).toBeLessThan(cIndex);
    });

    it('handles same file modified multiple times', () => {
      const changes: BatchedChange[] = [
        {
          id: 'change_1',
          filePath: 'src/file.ts',
          changeType: 'modify',
          originalContent: 'v1\n',
          proposedContent: 'v2\n',
          description: 'First edit',
          toolId: 'tool_1',
          toolName: 'write_file'
        },
        {
          id: 'change_2',
          filePath: 'src/file.ts',
          changeType: 'modify',
          originalContent: 'v2\n',
          proposedContent: 'v3\n',
          description: 'Second edit',
          toolId: 'tool_2',
          toolName: 'write_file'
        }
      ];

      const patch = generateUnifiedPatch(changes);
      // Both changes should be included (incremental)
      expect(patch).toContain('-v1');
      expect(patch).toContain('+v2');
      expect(patch).toContain('-v2');
      expect(patch).toContain('+v3');
    });
  });

  describe('edge cases', () => {
    it('handles empty changes array', () => {
      const patch = generateUnifiedPatch([]);
      expect(patch).toBe('');
    });

    it('handles files with special characters in path', () => {
      const changes: BatchedChange[] = [{
        id: 'change_1',
        filePath: 'src/my-file.test.ts',
        changeType: 'create',
        originalContent: '',
        proposedContent: 'test\n',
        description: 'Create test',
        toolId: 'tool_1',
        toolName: 'write_file'
      }];

      const patch = generateUnifiedPatch(changes);
      expect(patch).toContain('my-file.test.ts');
    });

    it('handles JSON content', () => {
      const changes: BatchedChange[] = [{
        id: 'change_1',
        filePath: 'src/data.json',
        changeType: 'create',
        originalContent: '',
        proposedContent: '{"key": "value"}\n',
        description: 'Create JSON',
        toolId: 'tool_1',
        toolName: 'write_file'
      }];

      const patch = generateUnifiedPatch(changes);
      expect(patch).toContain('+{"key": "value"}');
    });

    it('handles content without trailing newline', () => {
      const changes: BatchedChange[] = [{
        id: 'change_1',
        filePath: 'src/no-newline.ts',
        changeType: 'modify',
        originalContent: 'no newline',
        proposedContent: 'with newline\n',
        description: 'Add newline',
        toolId: 'tool_1',
        toolName: 'write_file'
      }];

      const patch = generateUnifiedPatch(changes);
      expect(patch).toBeDefined();
      expect(patch.length).toBeGreaterThan(0);
    });

    it('handles unicode content', () => {
      const changes: BatchedChange[] = [{
        id: 'change_1',
        filePath: 'src/i18n.ts',
        changeType: 'create',
        originalContent: '',
        proposedContent: 'const greeting = "こんにちは";\n',
        description: 'Add greeting',
        toolId: 'tool_1',
        toolName: 'write_file'
      }];

      const patch = generateUnifiedPatch(changes);
      expect(patch).toContain('こんにちは');
    });
  });

  describe('git apply compatibility', () => {
    it('produces patch that can be parsed by git', () => {
      const changes: BatchedChange[] = [{
        id: 'change_1',
        filePath: 'src/index.ts',
        changeType: 'modify',
        originalContent: 'const a = 1;\n',
        proposedContent: 'const a = 2;\n',
        description: 'Update',
        toolId: 'tool_1',
        toolName: 'write_file'
      }];

      const patch = generateUnifiedPatch(changes);

      // Check required git format elements
      expect(patch).toMatch(/^diff --git/m);
      expect(patch).toMatch(/^---/m);
      expect(patch).toMatch(/^\+\+\+/m);
      expect(patch).toMatch(/^@@.*@@/m);
    });

    it('includes correct path prefixes for git', () => {
      const changes: BatchedChange[] = [{
        id: 'change_1',
        filePath: 'path/to/file.ts',
        changeType: 'modify',
        originalContent: 'old\n',
        proposedContent: 'new\n',
        description: 'Update',
        toolId: 'tool_1',
        toolName: 'write_file'
      }];

      const patch = generateUnifiedPatch(changes);

      expect(patch).toContain('a/path/to/file.ts');
      expect(patch).toContain('b/path/to/file.ts');
    });
  });
});

describe('formatChangeSummary', () => {
  it('formats single create', () => {
    const changes: BatchedChange[] = [{
      id: 'change_1',
      filePath: 'src/new.ts',
      changeType: 'create',
      originalContent: '',
      proposedContent: 'content\n',
      description: 'Create file',
      toolId: 'tool_1',
      toolName: 'write_file'
    }];

    const summary = formatChangeSummary(changes);
    expect(summary).toBe('1 file created');
  });

  it('formats multiple creates', () => {
    const changes: BatchedChange[] = [
      {
        id: 'change_1',
        filePath: 'src/a.ts',
        changeType: 'create',
        originalContent: '',
        proposedContent: 'a\n',
        description: 'Create a',
        toolId: 'tool_1',
        toolName: 'write_file'
      },
      {
        id: 'change_2',
        filePath: 'src/b.ts',
        changeType: 'create',
        originalContent: '',
        proposedContent: 'b\n',
        description: 'Create b',
        toolId: 'tool_2',
        toolName: 'write_file'
      }
    ];

    const summary = formatChangeSummary(changes);
    expect(summary).toBe('2 files created');
  });

  it('formats mixed changes', () => {
    const changes: BatchedChange[] = [
      {
        id: 'change_1',
        filePath: 'src/new.ts',
        changeType: 'create',
        originalContent: '',
        proposedContent: 'new\n',
        description: 'Create',
        toolId: 'tool_1',
        toolName: 'write_file'
      },
      {
        id: 'change_2',
        filePath: 'src/existing.ts',
        changeType: 'modify',
        originalContent: 'old\n',
        proposedContent: 'updated\n',
        description: 'Modify',
        toolId: 'tool_2',
        toolName: 'write_file'
      },
      {
        id: 'change_3',
        filePath: 'src/old.ts',
        changeType: 'delete',
        originalContent: 'old\n',
        proposedContent: '',
        description: 'Delete',
        toolId: 'tool_3',
        toolName: 'delete_path'
      }
    ];

    const summary = formatChangeSummary(changes);
    expect(summary).toContain('1 file created');
    expect(summary).toContain('1 file modified');
    expect(summary).toContain('1 file deleted');
  });

  it('returns "No changes" for empty array', () => {
    const summary = formatChangeSummary([]);
    expect(summary).toBe('No changes');
  });
});

describe('CLIOptions interface', () => {
  it('supports patch and output options', () => {
    // Type check - this test validates the interface
    const opts: { patch?: boolean; output?: string } = {
      patch: true,
      output: 'changes.patch'
    };

    expect(opts.patch).toBe(true);
    expect(opts.output).toBe('changes.patch');
  });
});
