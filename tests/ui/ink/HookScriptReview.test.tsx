import React from 'react';
import { renderInkScreen } from '../../../src/testing/drivers/ink-driver.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HookScriptReview } from '../../../src/ui/ink/components/HookScriptReview.js';
import { Modal } from '../../../src/ui/ink/components/Modal.js';
import { hookBrowserOptions } from '../../../src/commands/hooks.js';
import { getLifecycleHookInventory } from '../../../src/core/hookEvents.js';
import { HookManager } from '../../../src/core/HookManager.js';

const mounted: { unmount(): void }[] = [];
afterEach(() => { for (const view of mounted.splice(0)) view.unmount(); });
function renderScreen(component: React.ReactElement) {
  const view = renderInkScreen(component);
  mounted.push(view);
  return view;
}

const settle = () => new Promise(resolve => setTimeout(resolve, 30));

describe('hook terminal screens', () => {
  it('renders the event table and navigates to a lifecycle event with Enter', async () => {
    const options = hookBrowserOptions(getLifecycleHookInventory(new HookManager({ workspaceRoot: '/test' })), '', 0, 100);
    const onSelect = vi.fn();
    const view = renderScreen(<Modal {...options} onSelect={onSelect} />);
    expect(view.lastFrame()).toContain('Installed');
    expect(view.lastFrame()).toContain('Active');
    expect(view.lastFrame()).toContain('session-start');
    await expect(view.lastFrame()).toMatchFileSnapshot('../../../src/testing/snapshots/lifecycle-hooks.txt');
    await settle();
    view.stdin.write('\u001b[B');
    await settle();
    view.stdin.write('\r');
    await settle();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ value: 'session-end' }));
    view.unmount();
  });
  it('keeps long scripts scrollable and saves only on explicit input', async () => {
    const onConfirm = vi.fn();
    const preview = Array.from({ length: 80 }, (_, i) => `Script line ${i}`).join('\n');
    const view = renderScreen(<HookScriptReview preview={preview} onConfirm={onConfirm} rows={14} columns={80} />);
    await settle();
    expect(view.lastFrame()).toContain('Script line 0');
    expect(view.lastFrame()).not.toContain('Script line 79');
    view.stdin.write('G');
    await settle();
    expect(view.lastFrame()).toContain('Script line 79');
    expect(onConfirm).not.toHaveBeenCalled();
    view.stdin.write('s');
    await settle();
    expect(onConfirm).toHaveBeenCalledWith(true);
    view.unmount();
  });
  it.each(['\u001b', '\u0003'])('cancels without saving on %j', async key => {
    const onConfirm = vi.fn();
    const view = renderScreen(<HookScriptReview preview="Example script" onConfirm={onConfirm} />);
    await settle();
    view.stdin.write(key);
    await settle();
    expect(onConfirm).toHaveBeenCalledWith(false);
    view.unmount();
  });
});
