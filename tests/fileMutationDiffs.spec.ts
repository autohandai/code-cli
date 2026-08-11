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

  /** Extract one complete top-level switch case without relying on source length. */
  function extractCaseBlock(caseName: string): string {
    const start = src.indexOf(`case '${caseName}'`);
    if (start === -1) throw new Error(`case '${caseName}' not found in actionExecutor.ts`);
    const nextCase = src.indexOf('\n      case ', start + 1);
    return src.slice(start, nextCase === -1 ? src.length : nextCase);
  }

  it('format_file calls notifyFileModified and showDiff when content changes', () => {
    const block = extractCaseBlock('format_file');
    expect(block).toContain('notifyFileModified');
    expect(block).toContain('context?.toolCallId');
    expect(block).toContain('showDiff');
    expect(block).toContain('formatDiffPreview');
  });

  it('delete_path calls notifyFileModified with delete type', () => {
    const block = extractCaseBlock('delete_path');
    expect(block).toContain('notifyFileModified');
    expect(block).toContain('context?.toolCallId');
    expect(block).toContain("'delete'");
  });

  it('delete_path reads old content before deletion for diff display', () => {
    const block = extractCaseBlock('delete_path');
    expect(block).toContain('readFile');
    expect(block).toContain('showDiff');
  });

  it('add_dependency shows package.json diff', () => {
    const block = extractCaseBlock('add_dependency');
    expect(block).toContain('notifyFileModified');
    expect(block).toContain('context?.toolCallId');
    expect(block).toContain('showDiff');
    expect(block).toContain('package.json');
  });

  it('remove_dependency shows package.json diff', () => {
    const block = extractCaseBlock('remove_dependency');
    expect(block).toContain('notifyFileModified');
    expect(block).toContain('context?.toolCallId');
    expect(block).toContain('showDiff');
    expect(block).toContain('package.json');
  });

  it('git_checkout shows diff and calls notifyFileModified', () => {
    const block = extractCaseBlock('git_checkout');
    expect(block).toContain('notifyFileModified');
    expect(block).toContain('context?.toolCallId');
    expect(block).toContain('showDiff');
    expect(block).toContain('formatDiffPreview');
  });

  it('rename_path calls notifyFileModified with create type', () => {
    const block = extractCaseBlock('rename_path');
    expect(block).toContain('notifyFileModified');
    expect(block).toContain('context?.toolCallId');
  });

  it('copy_path calls notifyFileModified with create type', () => {
    const block = extractCaseBlock('copy_path');
    expect(block).toContain('notifyFileModified');
    expect(block).toContain('context?.toolCallId');
  });

  it('todo_write calls notifyFileModified', () => {
    const block = extractCaseBlock('todo_write');
    expect(block).toContain('notifyFileModified');
    expect(block).toContain('context?.toolCallId');
  });
});
