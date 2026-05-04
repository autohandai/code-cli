/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { InkUIManager, type InkUIManagerOptions } from '../../src/ui/InkUIManager.js';
import type { InkRendererOptions } from '../../src/ui/ink/InkRenderer.js';

function createRenderer() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    setStatus: vi.fn(),
    setWorking: vi.fn(),
    setProviderModel: vi.fn(),
    setFinalResponse: vi.fn(),
    addUserMessage: vi.fn(),
    addToolOutput: vi.fn(),
    getState: vi.fn(() => ({ currentInput: 'draft' })),
    clearInput: vi.fn(),
    hasQueuedInstructions: vi.fn(() => false),
    dequeueInstruction: vi.fn(),
    getQueueCount: vi.fn(() => 0),
    addQueuedInstruction: vi.fn(),
    isRunning: vi.fn(() => true),
  };
}

describe('InkUIManager', () => {
  it('starts one renderer through the public manager API and seeds provider/model first', async () => {
    const renderer = createRenderer();
    const rendererFactory = vi.fn((_options: InkRendererOptions) => renderer);
    const manager = new InkUIManager({
      onInstruction: vi.fn(),
      onEscape: vi.fn(),
      onCtrlC: vi.fn(),
      rendererFactory,
    } as InkUIManagerOptions);

    manager.setProviderModel('openrouter', 'anthropic/claude-sonnet-4.5');
    await manager.start();
    await manager.start();

    expect(rendererFactory).toHaveBeenCalledTimes(1);
    expect(renderer.setProviderModel).toHaveBeenCalledWith(
      'openrouter',
      'anthropic/claude-sonnet-4.5'
    );
    expect(renderer.setProviderModel.mock.invocationCallOrder[0]).toBeLessThan(
      renderer.start.mock.invocationCallOrder[0]
    );
    expect(renderer.start).toHaveBeenCalledTimes(1);
    expect(manager.getInkRenderer()).toBe(renderer);
  });

  it('resolves waitForInput from renderer-submitted instructions', async () => {
    const renderer = createRenderer();
    let onRendererInstruction: ((text: string) => void) | undefined;
    const rendererFactory = vi.fn((options: InkRendererOptions) => {
      onRendererInstruction = options.onInstruction;
      return renderer;
    });
    const manager = new InkUIManager({
      onInstruction: vi.fn(),
      onEscape: vi.fn(),
      onCtrlC: vi.fn(),
      rendererFactory,
    } as InkUIManagerOptions);

    await manager.start();
    const input = manager.waitForInput();
    onRendererInstruction?.('queued prompt');

    await expect(input).resolves.toBe('queued prompt');
    expect(renderer.addQueuedInstruction).toHaveBeenCalledWith('queued prompt');
  });

  it('forwards lifecycle and display calls through the public manager API', async () => {
    const renderer = createRenderer();
    const rendererFactory = vi.fn((_options: InkRendererOptions) => renderer);
    const manager = new InkUIManager({
      onInstruction: vi.fn(),
      onEscape: vi.fn(),
      onCtrlC: vi.fn(),
      rendererFactory,
    } as InkUIManagerOptions);

    await manager.start();
    manager.setStatus('Thinking');
    manager.setWorking(true, 'Gathering context');
    manager.setFinalResponse('Done');
    manager.addUserMessage('hello');
    manager.addToolOutput('shell', true, 'ok');
    manager.clearInput();
    await manager.pause();
    await manager.resume();
    await manager.stop();

    expect(renderer.setStatus).toHaveBeenCalledWith('Thinking');
    expect(renderer.setWorking).toHaveBeenCalledWith(true, 'Gathering context');
    expect(renderer.setFinalResponse).toHaveBeenCalledWith('Done');
    expect(renderer.addUserMessage).toHaveBeenCalledWith('hello');
    expect(renderer.addToolOutput).toHaveBeenCalledWith('shell', true, 'ok');
    expect(renderer.clearInput).toHaveBeenCalledTimes(1);
    expect(renderer.pause).toHaveBeenCalledTimes(1);
    expect(renderer.resume).toHaveBeenCalledTimes(1);
    expect(renderer.stop).toHaveBeenCalledTimes(1);
  });
});
