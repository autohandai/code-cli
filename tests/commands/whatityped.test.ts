/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TypedMessageHistory } from '../../src/session/TypedMessageHistory.js';
import { whatityped } from '../../src/commands/whatityped.js';
import { showModal } from '../../src/ui/ink/components/Modal.js';

vi.mock('../../src/ui/ink/components/Modal.js', () => ({ showModal: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

describe('/whatityped', () => {
  it('offers prompts from all directories and loads the selection without submitting', async () => {
    const history = new TypedMessageHistory();
    await history.record('first\nmessage', '/one');
    await history.record('second message', '/two');
    const setComposerInput = vi.fn();
    const order: string[] = [];
    vi.mocked(showModal).mockImplementation(async options => {
      order.push('modal');
      expect(options.options).toMatchObject([
        { label: 'second message', description: expect.stringContaining('/two') },
        { label: 'first message', description: expect.stringContaining('/one') },
      ]);
      return options.options[1];
    });
    await whatityped({
      setComposerInput,
      onBeforeModal: () => { order.push('pause'); },
      onAfterModal: () => { order.push('resume'); },
    }, history);
    expect(order).toEqual(['pause', 'modal', 'resume']);
    expect(setComposerInput).toHaveBeenCalledWith('first\nmessage');
  });

  it('leaves the composer alone on cancellation and restores it after modal errors', async () => {
    const history = new TypedMessageHistory();
    await history.record('message', '/cwd');
    const context = { setComposerInput: vi.fn(), onAfterModal: vi.fn() };
    vi.mocked(showModal).mockResolvedValue(null);
    await whatityped(context, history);
    expect(context.setComposerInput).not.toHaveBeenCalled();
    vi.mocked(showModal).mockRejectedValue(new Error('modal failed'));
    await expect(whatityped(context, history)).rejects.toThrow('modal failed');
    expect(context.onAfterModal).toHaveBeenCalledTimes(2);
  });

  it('reports empty history without opening a menu', async () => {
    expect(await whatityped({ setComposerInput: vi.fn() }, new TypedMessageHistory())).toContain('No typed messages');
    expect(showModal).not.toHaveBeenCalled();
  });
});
