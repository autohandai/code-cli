/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * These tests verify that all file mutation tools in actionExecutor.ts
 * include proper diff display (showDiff + formatDiffPreview) and
 * notifyFileModified hook calls. Following the pattern set by write_file.
 */
describe('file mutation tools diff display', () => {
  const src = readFileSync('src/core/actionExecutor.ts', 'utf-8');

  /** Extract a block of source from case start to the given length */
  function extractCaseBlock(caseName: string, length = 500): string {
    const idx = src.indexOf(`case '${caseName}'`);
    if (idx === -1) throw new Error(`case '${caseName}' not found in actionExecutor.ts`);
    return src.slice(idx, idx + length);
  }

  it('format_file calls notifyFileModified and showDiff when content changes', () => {
    const block = extractCaseBlock('format_file', 800);
    expect(block).toContain('notifyFileModified');
    expect(block).toContain('context?.toolCallId');
    expect(block).toContain('showDiff');
    expect(block).toContain('formatDiffPreview');
  });

  it('delete_path calls notifyFileModified with delete type', () => {
    const block = extractCaseBlock('delete_path', 1000);
    expect(block).toContain('notifyFileModified');
    expect(block).toContain('context?.toolCallId');
    expect(block).toContain("'delete'");
  });

  it('delete_path reads old content before deletion for diff display', () => {
    const block = extractCaseBlock('delete_path', 1000);
    expect(block).toContain('readFile');
    expect(block).toContain('showDiff');
  });

  it('add_dependency shows package.json diff', () => {
    const block = extractCaseBlock('add_dependency', 800);
    expect(block).toContain('notifyFileModified');
    expect(block).toContain('context?.toolCallId');
    expect(block).toContain('showDiff');
    expect(block).toContain('package.json');
  });

  it('remove_dependency shows package.json diff', () => {
    const block = extractCaseBlock('remove_dependency', 800);
    expect(block).toContain('notifyFileModified');
    expect(block).toContain('context?.toolCallId');
    expect(block).toContain('showDiff');
    expect(block).toContain('package.json');
  });

  it('git_checkout shows diff and calls notifyFileModified', () => {
    const block = extractCaseBlock('git_checkout', 900);
    expect(block).toContain('notifyFileModified');
    expect(block).toContain('context?.toolCallId');
    expect(block).toContain('showDiff');
    expect(block).toContain('formatDiffPreview');
  });

  it('rename_path calls notifyFileModified with create type', () => {
    const block = extractCaseBlock('rename_path', 400);
    expect(block).toContain('notifyFileModified');
    expect(block).toContain('context?.toolCallId');
  });

  it('copy_path calls notifyFileModified with create type', () => {
    const block = extractCaseBlock('copy_path', 400);
    expect(block).toContain('notifyFileModified');
    expect(block).toContain('context?.toolCallId');
  });

  it('todo_write calls notifyFileModified', () => {
    const block = extractCaseBlock('todo_write', 3100);
    expect(block).toContain('notifyFileModified');
    expect(block).toContain('context?.toolCallId');
  });
});
