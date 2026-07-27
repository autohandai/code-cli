/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnouncementManager } from '../../src/announcements/AnnouncementManager.js';
import { AnnouncementStore } from '../../src/announcements/AnnouncementStore.js';
import type { ApiAnnouncement } from '../../src/announcements/AnnouncementContent.js';
import type { LoadedConfig } from '../../src/types.js';

const announcements: ApiAnnouncement[] = [
  {
    id: 'high',
    title: 'High priority',
    description: null,
    priority: 100,
    steps: [
      {
        id: 'high-step-first',
        order: 0,
        type: 'image',
        mediaUrl: 'ignored',
        posterUrl: null,
        title: null,
        description: 'First details',
        ctaLabel: null,
        ctaUrl: null,
      },
      {
        id: 'high-step-last',
        order: 2,
        type: 'image',
        mediaUrl: 'ignored',
        posterUrl: null,
        title: null,
        description: 'Later details',
        ctaLabel: null,
        ctaUrl: null,
      },
    ],
  },
  {
    id: 'low',
    title: 'Low priority',
    description: null,
    priority: 1,
    steps: [],
  },
];

describe('AnnouncementManager', () => {
  let tempDirectory: string;
  let store: AnnouncementStore;
  let client: {
    fetchAnnouncements: ReturnType<typeof vi.fn>;
    postSeen: ReturnType<typeof vi.fn>;
    postDismiss: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'announcement-manager-'));
    store = new AnnouncementStore(path.join(tempDirectory, 'announcements.json'));
    await store.replaceAnnouncements(announcements);
    client = {
      fetchAnnouncements: vi.fn(),
      postSeen: vi.fn().mockResolvedValue(undefined),
      postDismiss: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(async () => {
    await fs.remove(tempDirectory);
  });

  function manager(): AnnouncementManager {
    return new AnnouncementManager({
      configPath: '/tmp/config.json',
      provider: 'openrouter',
    } as LoadedConfig, { store, client });
  }

  it('preserves server order and filters local dismissals', async () => {
    const subject = manager();
    expect(subject.getTop()?.id).toBe('high');

    await subject.dismiss('high');

    expect(subject.getActive().map((item) => item.id)).toEqual(['low']);
    expect(client.postDismiss).toHaveBeenCalledWith('high');
  });

  it('marks each announcement seen once per process with the highest displayed step', async () => {
    const subject = manager();

    await subject.markSeen('high');
    await subject.markSeen('high');

    expect(client.postSeen).toHaveBeenCalledTimes(1);
    expect(client.postSeen).toHaveBeenCalledWith('high', 2);
  });

  it('records only the first line step when the line is the first presentation', async () => {
    const subject = manager();

    await subject.markSeen('high', 0);
    await subject.markSeen('high');

    expect(client.postSeen).toHaveBeenCalledTimes(1);
    expect(client.postSeen).toHaveBeenCalledWith('high', 0);
  });

  it('refreshes successful payloads, retains offline cache, and notifies subscribers', async () => {
    const subject = manager();
    const listener = vi.fn();
    subject.subscribe(listener);
    client.fetchAnnouncements.mockResolvedValueOnce([announcements[1]]);

    await subject.refresh();
    expect(subject.getTop()?.id).toBe('low');
    expect(listener).toHaveBeenCalledTimes(1);

    client.fetchAnnouncements.mockResolvedValueOnce(null);
    await subject.refresh();
    expect(subject.getTop()?.id).toBe('low');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps cached rendering and local dismissal offline without network requests', async () => {
    const subject = manager();
    subject.setNetworkEnabled(false);

    await subject.markSeen('high');
    await subject.refresh();
    await subject.dismiss('high');

    expect(subject.getTop()?.id).toBe('low');
    expect(client.fetchAnnouncements).not.toHaveBeenCalled();
    expect(client.postSeen).not.toHaveBeenCalled();
    expect(client.postDismiss).not.toHaveBeenCalled();
  });
});
