import React from 'react';
import { stripVTControlCharacters } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderInkScreen } from '../../../src/testing/drivers/ink-driver.js';
import { Modal } from '../../../src/ui/ink/components/Modal.js';
import { workspaceTrustModalOptions } from '../../../src/startup/workspaceTrustPrompt.js';
import type { WorkspaceTrustState } from '../../../src/types.js';

const mounted: { unmount(): void }[] = [];
afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount();
});

const settle = () => new Promise(resolve => setTimeout(resolve, 30));

const trust: WorkspaceTrustState = {
  workspaceRoot: '/work/cloned-repo',
  fingerprint: 'b'.repeat(64),
  trusted: false,
  hooks: [{ event: 'session-start', command: 'node scripts/record.cjs start' }],
  mcpServers: [{ name: 'project-tools', transport: 'stdio', command: 'npx', args: ['project-tools-mcp'] }],
};

function renderPrompt() {
  const onSelect = vi.fn();
  const onCancel = vi.fn();
  const view = renderInkScreen(<Modal {...workspaceTrustModalOptions(trust)} onSelect={onSelect} onCancel={onCancel} />);
  mounted.push(view);
  return { view, onSelect, onCancel };
}

describe('workspace trust prompt screen', () => {
  it('shows what would run and both choices, with trust selected first', () => {
    const { view } = renderPrompt();
    const frame = stripVTControlCharacters(view.lastFrame() ?? '');

    expect(frame).toContain('/work/cloned-repo');
    expect(frame).toContain('node scripts/record.cjs start');
    expect(frame).toContain('npx project-tools-mcp');
    expect(frame).toContain('Trust this workspace');
    expect(frame).toContain('Not now');
  });

  it('returns trust on Enter, not now after moving down, and cancels on Escape', async () => {
    const first = renderPrompt();
    await settle();
    first.view.stdin.write('\r');
    await settle();
    expect(first.onSelect).toHaveBeenCalledWith(expect.objectContaining({ value: 'trust' }));

    const second = renderPrompt();
    await settle();
    second.view.stdin.write('[B');
    await settle();
    second.view.stdin.write('\r');
    await settle();
    expect(second.onSelect).toHaveBeenCalledWith(expect.objectContaining({ value: 'skip' }));

    const third = renderPrompt();
    await settle();
    third.view.stdin.write('');
    await settle();
    expect(third.onCancel).toHaveBeenCalled();
    expect(third.onSelect).not.toHaveBeenCalled();
  });
});
