/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LoadedConfig } from '../types.js';
import { AnnouncementClient } from './AnnouncementClient.js';
import {
  mapApiAnnouncement,
  type ApiAnnouncement,
  type CliAnnouncement,
} from './AnnouncementContent.js';
import { AnnouncementStore } from './AnnouncementStore.js';

export interface AnnouncementClientContract {
  fetchAnnouncements(): Promise<ApiAnnouncement[] | null>;
  postSeen(id: string, lastStep: number | null): Promise<void>;
  postDismiss(id: string): Promise<void>;
}

export interface AnnouncementManagerOptions {
  client?: AnnouncementClientContract;
  store?: AnnouncementStore;
}

export type AnnouncementListener = () => void;

export interface AnnouncementManagerContract {
  getActive(): CliAnnouncement[];
  getTop(): CliAnnouncement | null;
  dismiss(id: string): Promise<void>;
  markSeen(id: string, displayedLastStep?: number | null): Promise<void>;
  refresh(): Promise<void>;
  subscribe(listener: AnnouncementListener): () => void;
}

const processManagers = new WeakMap<LoadedConfig, AnnouncementManager>();

export class AnnouncementManager implements AnnouncementManagerContract {
  private readonly client: AnnouncementClientContract;
  private readonly store: AnnouncementStore;
  private readonly seenIds = new Set<string>();
  private readonly listeners = new Set<AnnouncementListener>();
  private networkEnabled = true;

  constructor(config: LoadedConfig, options: AnnouncementManagerOptions = {}) {
    this.client = options.client ?? new AnnouncementClient(config);
    this.store = options.store ?? new AnnouncementStore();
  }

  getActive(): CliAnnouncement[] {
    const dismissed = new Set(this.store.getDismissedIds());
    return this.store.getAnnouncements()
      .filter((announcement) => !dismissed.has(announcement.id))
      .map(mapApiAnnouncement)
      .filter((announcement): announcement is CliAnnouncement => announcement !== null);
  }

  getTop(): CliAnnouncement | null {
    return this.getActive()[0] ?? null;
  }

  setNetworkEnabled(enabled: boolean): void {
    this.networkEnabled = enabled;
  }

  async dismiss(id: string): Promise<void> {
    const persistence = this.store.dismiss(id);
    this.emitChange();
    await persistence;
    if (this.networkEnabled) {
      await this.client.postDismiss(id);
    }
  }

  async markSeen(id: string, displayedLastStep?: number | null): Promise<void> {
    if (this.seenIds.has(id)) {
      return;
    }
    const announcement = this.getActive().find((candidate) => candidate.id === id);
    if (!announcement) {
      return;
    }
    this.seenIds.add(id);
    if (this.networkEnabled) {
      await this.client.postSeen(
        id,
        displayedLastStep === undefined ? announcement.lastStep : displayedLastStep,
      );
    }
  }

  async refresh(): Promise<void> {
    if (!this.networkEnabled) {
      return;
    }
    const announcements = await this.client.fetchAnnouncements();
    if (!announcements) {
      return;
    }
    await this.store.replaceAnnouncements(announcements);
    this.emitChange();
  }

  subscribe(listener: AnnouncementListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export function getAnnouncementManager(config: LoadedConfig): AnnouncementManager {
  const existing = processManagers.get(config);
  if (existing) {
    return existing;
  }
  const manager = new AnnouncementManager(config);
  processManagers.set(config, manager);
  return manager;
}
