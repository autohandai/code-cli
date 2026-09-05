/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlashCommandHandler } from '../../src/core/slashCommandHandler.js';
import { SLASH_COMMANDS } from '../../src/core/slashCommands.js';
import type { SlashCommandContext } from '../../src/core/slashCommandTypes.js';

afterEach(() => vi.restoreAllMocks());

describe('session agent inspector slash dispatch', () => {
  it('opens the live inspector without pausing or remounting the active renderer', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const onBeforeModal = vi.fn();
    const onAfterModal = vi.fn();
    const onToggleAgentRunsView = vi.fn();
    const handler = new SlashCommandHandler({ config: {}, workspaceRoot: '/repo',
      onBeforeModal, onAfterModal, onToggleAgentRunsView,
    } as SlashCommandContext, SLASH_COMMANDS);
    expect(await handler.handle('/agents', ['view'])).toBeNull();
    expect(onToggleAgentRunsView).toHaveBeenCalledWith(true);
    expect(onBeforeModal).not.toHaveBeenCalled();
    expect(onAfterModal).not.toHaveBeenCalled();
  });
});
