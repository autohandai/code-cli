/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { InkRenderer } from '../../../src/ui/ink/InkRenderer.js';
import { MAX_TOOL_OUTPUT_ENTRIES, MAX_VISIBLE_NOTIFICATIONS } from '../../../src/ui/ink/AgentUI.js';

function createRenderer(): InkRenderer {
  return new InkRenderer({
    onInstruction: () => {},
    onEscape: () => {},
    onCtrlC: () => {},
  });
}

describe('InkRenderer memory bounds', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears the pending live output flush timer when the renderer stops', () => {
    vi.useFakeTimers();
    const renderer = createRenderer();
    const commandId = renderer.startLiveCommand('! bun run proof');
    renderer.appendLiveCommandOutput(commandId, 'stdout', 'still streaming\n');
    expect(vi.getTimerCount()).toBe(1);

    renderer.stop();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps only the tool outputs that can still be rendered', () => {
    const renderer = createRenderer();
    const total = MAX_TOOL_OUTPUT_ENTRIES + 25;
    for (let index = 0; index < total; index += 1) {
      renderer.addToolOutput('read_file', true, `output ${index}`);
    }

    const { toolOutputs } = renderer.getState();
    expect(toolOutputs).toHaveLength(MAX_TOOL_OUTPUT_ENTRIES);
    expect(toolOutputs[0]?.output).toBe(`output ${total - MAX_TOOL_OUTPUT_ENTRIES}`);
    expect(toolOutputs[toolOutputs.length - 1]?.output).toBe(`output ${total - 1}`);
  });

  it('keeps only the notifications that can still be rendered', () => {
    const renderer = createRenderer();
    const total = MAX_VISIBLE_NOTIFICATIONS + 10;
    for (let index = 0; index < total; index += 1) {
      renderer.addNotification(`notice ${index}`);
    }
    renderer.upsertNotification('peer-join', 'peer joined');

    const { notifications } = renderer.getState();
    expect(notifications).toHaveLength(MAX_VISIBLE_NOTIFICATIONS);
    expect(notifications[notifications.length - 1]).toBe('peer joined');
  });
});
