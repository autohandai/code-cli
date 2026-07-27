/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { showModal } = vi.hoisted(() => ({ showModal: vi.fn() }));
vi.mock('../../src/ui/ink/components/Modal.js', () => ({ showModal }));

import { whatsnew } from '../../src/commands/whatsnew.js';
import type { CliAnnouncement } from '../../src/announcements/AnnouncementContent.js';
import { SlashCommandHandler } from '../../src/core/slashCommandHandler.js';
import { SLASH_COMMANDS } from '../../src/core/slashCommands.js';

const active: CliAnnouncement[] = [
  {
    id: 'one',
    headline: 'Voice dictation',
    bodyLines: ['Use Ctrl+V'],
    cta: '→ https://example.com/voice',
    priority: 10,
    lineLastStep: 0,
    lastStep: 0,
  },
  {
    id: 'two',
    headline: 'Squad mode',
    bodyLines: ['Run /team'],
    priority: 5,
    lineLastStep: 0,
    lastStep: 0,
  },
];

describe('/whatsnew', () => {
  beforeEach(() => {
    showModal.mockReset();
  });

  it('refreshes, marks displayed announcements seen, and dismisses selections', async () => {
    const manager = {
      refresh: vi.fn().mockResolvedValue(undefined),
      getActive: vi.fn()
        .mockReturnValueOnce(active)
        .mockReturnValueOnce(active.slice(1)),
      markSeen: vi.fn().mockResolvedValue(undefined),
      dismiss: vi.fn().mockResolvedValue(undefined),
    };
    showModal
      .mockResolvedValueOnce({ label: active[0].headline, value: active[0].id })
      .mockResolvedValueOnce(null);

    await whatsnew({ announcementManager: manager });

    expect(manager.refresh).toHaveBeenCalledTimes(1);
    expect(manager.markSeen).toHaveBeenCalledWith('one');
    expect(manager.markSeen).toHaveBeenCalledWith('two');
    expect(manager.dismiss).toHaveBeenCalledWith('one');
    expect(showModal.mock.calls[0]?.[0]).toMatchObject({
      title: "What's new",
      hint: '↑↓ move  ·  enter dismiss  ·  esc close',
    });
  });

  it('returns an informative message when no announcements are active', async () => {
    const manager = {
      refresh: vi.fn().mockResolvedValue(undefined),
      getActive: vi.fn().mockReturnValue([]),
      markSeen: vi.fn(),
      dismiss: vi.fn(),
    };

    await expect(whatsnew({ announcementManager: manager })).resolves.toBe('No new announcements.');
    expect(showModal).not.toHaveBeenCalled();
  });

  it('is registered and dispatches inside the shared modal lifecycle', async () => {
    const onBeforeModal = vi.fn();
    const onAfterModal = vi.fn();
    const manager = {
      refresh: vi.fn().mockResolvedValue(undefined),
      getActive: vi.fn().mockReturnValue([]),
      getTop: vi.fn().mockReturnValue(null),
      markSeen: vi.fn(),
      dismiss: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    };
    const context = {
      promptModelSelection: vi.fn(),
      createAgentsFile: vi.fn(),
      resetConversation: vi.fn(),
      sessionManager: {},
      memoryManager: {},
      permissionManager: {},
      llm: {},
      workspaceRoot: '/tmp',
      model: 'test',
      announcementManager: manager,
      onBeforeModal,
      onAfterModal,
    };

    expect(SLASH_COMMANDS.map((command) => command.command)).toContain('/whatsnew');
    const handler = new SlashCommandHandler(context as never, SLASH_COMMANDS);
    await handler.handle('/whatsnew');

    expect(onBeforeModal).toHaveBeenCalledTimes(1);
    expect(onAfterModal).toHaveBeenCalledTimes(1);
  });
});
