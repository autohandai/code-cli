/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import { z } from 'zod';
import { AUTOHAND_FILES } from '../constants.js';
import { atomicWriteJson } from '../utils/atomicFile.js';
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
    // The server omits announcements it has recorded as dismissed, so an id that
    // is no longer in the payload is settled and its local entry can go. One that
    // is still being served means the dismiss POST never landed, so it has to stay
    // or the announcement would reappear.
    const served = new Set(announcements.map((announcement) => announcement.id));
    this.cache = {
      announcements: [...announcements],
      dismissedIds: this.cache.dismissedIds.filter((id) => served.has(id)),
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
    // The write queue only serializes this process. Two autohand sessions share
    // this file, so the commit itself has to be atomic or a torn write takes the
    // cached payload and every local dismissal down with it.
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await atomicWriteJson(this.cachePath, snapshot);
      } catch {
        // Announcement cache failures must never affect CLI behavior.
      }
    });
    await this.writeQueue;
  }
}
