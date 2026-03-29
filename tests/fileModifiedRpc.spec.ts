/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('file-modified event wiring', () => {
  it('AgentOutputEvent type includes file_modified', () => {
    const src = readFileSync('src/types.ts', 'utf-8');
    expect(src).toContain("'file_modified'");
  });

  it('AgentOutputEvent carries filePath and changeType for file_modified', () => {
    const src = readFileSync('src/types.ts', 'utf-8');
    // The AgentOutputEvent interface must include filePath and changeType fields
    expect(src).toContain("filePath?: string");
    expect(src).toContain("changeType?: 'create' | 'modify' | 'delete'");
  });

  it('markFilesModified emits file_modified output event', () => {
    const src = readFileSync('src/core/agent.ts', 'utf-8');
    // Should emit output event for RPC/ACP forwarding
    expect(src).toContain("type: 'file_modified'");
  });

  it('RPC adapter handles file_modified output events in handleAgentOutput', () => {
    const src = readFileSync('src/modes/rpc/adapter.ts', 'utf-8');
    // The switch in handleAgentOutput must have a case for file_modified
    expect(src).toContain("case 'file_modified'");
  });

  it('ACP adapter handles file_modified output events in handleAgentOutput', () => {
    const src = readFileSync('src/modes/acp/adapter.ts', 'utf-8');
    // The switch in handleAgentOutput must have a case for file_modified
    expect(src).toContain("case 'file_modified'");
  });

  it('RPC adapter emits HOOK_FILE_MODIFIED notification for file_modified events', () => {
    const src = readFileSync('src/modes/rpc/adapter.ts', 'utf-8');
    // Should use the existing HOOK_FILE_MODIFIED notification constant
    expect(src).toContain('HOOK_FILE_MODIFIED');
    // Should forward filePath and changeType
    expect(src).toContain('event.filePath');
    expect(src).toContain('event.changeType');
  });

  it('ACP adapter calls emitHookFileModified for file_modified events', () => {
    const src = readFileSync('src/modes/acp/adapter.ts', 'utf-8');
    // Should call emitHookFileModified within the file_modified case
    expect(src).toContain('this.emitHookFileModified');
    // Should forward event.filePath
    expect(src).toContain('event.filePath');
  });

  it('RPC types already define HOOK_FILE_MODIFIED notification', () => {
    const src = readFileSync('src/modes/rpc/types.ts', 'utf-8');
    expect(src).toContain("HOOK_FILE_MODIFIED: 'autohand.hook.fileModified'");
  });

  it('ACP types already define HOOK_FILE_MODIFIED notification', () => {
    const src = readFileSync('src/modes/acp/types.ts', 'utf-8');
    expect(src).toContain("HOOK_FILE_MODIFIED: 'autohand.hook.fileModified'");
  });
});
