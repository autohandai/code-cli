import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { launchInk } from '../../src/testing/drivers/ink-driver.js';
import { CloudReviewScreen, CloudScreen } from '../../src/cloud/CloudScreen.js';
import type { CloudSessionState } from '../../src/cloud/CloudSession.js';

const id = '11111111-1111-4111-8111-111111111111';
const state: CloudSessionState = { conversation: { id, title: 'Repair parser', model: 'moa', updated_at: '2026-10-12' }, messages: [{ id, role: 'assistant', content: 'Parser tests passed', request_id: id, status: 'complete' }], jobs: [{ id, state: 'queued', revision: 2, content: 'Keep the public API' }], interaction: null, selected: 0, busy: false, connected: true, notice: 'Cloud session connected' };
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function launch(override: Partial<CloudSessionState> = {}, submit = vi.fn().mockResolvedValue(true)) {
  const select = vi.fn(), detach = vi.fn();
  const screen = launchInk(<CloudScreen state={{ ...state, ...override }} onSubmit={submit} onSelect={select} onDetach={detach} />);
  cleanups.push(() => screen.unmount()); return { screen, submit, select, detach };
}
describe('cloud terminal screen', () => {
  it('leaves a review pending when it is cancelled with Escape', async () => {
    const decide = vi.fn();
    const screen = launchInk(<CloudReviewScreen interaction={{ id, revision: 4, state: 'pending', payload: { kind: 'approval', repository: 'autohand/parser', action: { type: 'write_file', path: 'parser.ts', content: 'Reviewed change' } } }} onDecision={decide} />);
    cleanups.push(() => screen.unmount());
    await screen.settle(); expect(decide).not.toHaveBeenCalled();
    await screen.escape(); expect(decide).toHaveBeenCalledWith(false);
  });
  it('renders the actual hosted transcript and queue with detach instructions', async () => {
    const { screen } = launch(); await screen.settle();
    expect(screen.snapshot()).toContain('Autohand Cloud');
    expect(screen.snapshot()).toContain('Parser tests passed');
    expect(screen.snapshot()).toContain('Keep the public API');
    expect(screen.snapshot()).toContain('Ctrl+C detaches');
  });
  it('keeps the selected queued message visible beyond the first ten rows', async () => {
    const jobs = Array.from({ length: 12 }, (_, index) => ({ ...state.jobs[0], id: `${id}-${index}`, content: `Correction ${index + 1}` }));
    const { screen } = launch({ jobs, selected: 10 });
    await screen.settle();
    expect(screen.snapshot()).toContain('› 11. Correction 11');
    expect(screen.snapshot()).toContain('12. Correction 12');
  });
  it('queues Enter, navigates queued rows, and detaches with Ctrl+C', async () => {
    const { screen, submit, select, detach } = launch(); await screen.settle();
    await screen.type('Review parser'); await screen.enter();
    expect(submit).toHaveBeenCalledWith('Review parser');
    await screen.up(); await screen.down();
    expect(select.mock.calls).toEqual([[-1], [1]]);
    await screen.ctrlC(); expect(detach).toHaveBeenCalledOnce();
  });
  it('retains rejected drafts and supports editing without resending them', async () => {
    const submit = vi.fn().mockResolvedValue(false), { screen } = launch({}, submit);
    await screen.settle(); await screen.type('Repair parser'); await screen.enter();
    expect(screen.snapshot()).toContain('Repair parser');
    await screen.type('\x7f'); await screen.type('!');
    expect(screen.snapshot()).toContain('Repair parse!');
    expect(submit).toHaveBeenCalledOnce();
  });
  it('strips remote terminal controls before rendering and exposes approvals for review', async () => {
    const { screen } = launch({ notice: '\x1b]52;c;c2VjcmV0\x07Cloud connected', interaction: { id, revision: 0, state: 'pending', payload: { kind: 'approval', repository: 'autohand/parser', action: { action: 'command', command: 'bun test' } } } });
    await screen.settle(); expect(screen.snapshot()).not.toContain('52;c;');
    expect(screen.snapshot()).toContain('bun test'); expect(screen.snapshot()).toContain('/approve');
  });
  it('does not accept another submission while a cloud operation is pending', async () => {
    const { screen, submit } = launch({ busy: true }); await screen.settle();
    await screen.type('Repair parser'); await screen.enter(); expect(submit).not.toHaveBeenCalled();
  });
});
