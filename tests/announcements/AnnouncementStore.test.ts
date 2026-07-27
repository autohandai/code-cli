/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnnouncementStore } from '../../src/announcements/AnnouncementStore.js';
import type { ApiAnnouncement } from '../../src/announcements/AnnouncementContent.js';

const payload: ApiAnnouncement[] = [{
  id: 'announcement-1',
  title: 'Hello',
  description: null,
  priority: 1,
  steps: [],
}];

describe('AnnouncementStore', () => {
  let tempDirectory: string;
  let cachePath: string;

  beforeEach(async () => {
    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-announcements-'));
    cachePath = path.join(tempDirectory, 'announcements.json');
  });

  afterEach(async () => {
    await fs.remove(tempDirectory);
  });

  it('degrades missing and corrupt cache files to an empty state', async () => {
    expect(new AnnouncementStore(cachePath).getAnnouncements()).toEqual([]);
    await fs.writeFile(cachePath, '{');
    expect(new AnnouncementStore(cachePath).getAnnouncements()).toEqual([]);
  });

  it('persists dismissed IDs and the last good payload across loads', async () => {
    const store = new AnnouncementStore(cachePath);
    await store.replaceAnnouncements(payload);
    await store.dismiss('announcement-1');

    const reloaded = new AnnouncementStore(cachePath);
    expect(reloaded.getAnnouncements()).toEqual(payload);
    expect(reloaded.getDismissedIds()).toEqual(['announcement-1']);
  });

  it('keeps the previous payload when a refresh has no downloaded data', async () => {
    await new AnnouncementStore(cachePath).replaceAnnouncements(payload);
    const offline = new AnnouncementStore(cachePath);

    expect(offline.getAnnouncements()).toEqual(payload);
  });

  it('never throws when the cache directory is unwritable', async () => {
    const notADirectory = path.join(tempDirectory, 'file');
    await fs.writeFile(notADirectory, 'occupied');
    const store = new AnnouncementStore(path.join(notADirectory, 'announcements.json'));

    await expect(store.replaceAnnouncements(payload)).resolves.toBeUndefined();
    await expect(store.dismiss('announcement-1')).resolves.toBeUndefined();
  });
});
