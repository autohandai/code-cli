/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import fs from 'fs-extra';
import { z } from 'zod';
import { AUTOHAND_FILES } from '../constants.js';
import {
  ApiAnnouncementSchema,
  type ApiAnnouncement,
} from './AnnouncementContent.js';

const AnnouncementCacheSchema = z.object({
  announcements: z.array(ApiAnnouncementSchema),
  dismissedIds: z.array(z.string()),
});

interface AnnouncementCache {
  announcements: ApiAnnouncement[];
  dismissedIds: string[];
}

const EMPTY_CACHE: AnnouncementCache = {
  announcements: [],
  dismissedIds: [],
};

export class AnnouncementStore {
  private cache: AnnouncementCache;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly cachePath = AUTOHAND_FILES.announcementsCache,
  ) {
    this.cache = this.load();
  }

  getAnnouncements(): ApiAnnouncement[] {
    return [...this.cache.announcements];
  }

  getDismissedIds(): string[] {
    return [...this.cache.dismissedIds];
  }

  async replaceAnnouncements(announcements: ApiAnnouncement[]): Promise<void> {
    this.cache = {
      announcements: [...announcements],
      dismissedIds: this.cache.dismissedIds,
    };
    await this.persist();
  }

  async dismiss(id: string): Promise<void> {
    if (!this.cache.dismissedIds.includes(id)) {
      this.cache = {
        announcements: this.cache.announcements,
        dismissedIds: [...this.cache.dismissedIds, id],
      };
    }
    await this.persist();
  }

  private load(): AnnouncementCache {
    try {
      if (!fs.pathExistsSync(this.cachePath)) {
        return { ...EMPTY_CACHE };
      }
      const parsed = AnnouncementCacheSchema.safeParse(fs.readJsonSync(this.cachePath));
      if (!parsed.success) {
        return { ...EMPTY_CACHE };
      }
      return {
        announcements: parsed.data.announcements,
        dismissedIds: [...new Set(parsed.data.dismissedIds)],
      };
    } catch {
      return { ...EMPTY_CACHE };
    }
  }

  private async persist(): Promise<void> {
    const snapshot: AnnouncementCache = {
      announcements: [...this.cache.announcements],
      dismissedIds: [...this.cache.dismissedIds],
    };
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await fs.ensureDir(path.dirname(this.cachePath));
        await fs.writeJson(this.cachePath, snapshot, { spaces: 2 });
      } catch {
        // Announcement cache failures must never affect CLI behavior.
      }
    });
    await this.writeQueue;
  }
}
