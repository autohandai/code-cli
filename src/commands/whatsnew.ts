/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { showModal, type ModalOption } from '../ui/ink/components/Modal.js';
import type { CliAnnouncement } from '../announcements/AnnouncementContent.js';
import type { AnnouncementManagerContract } from '../announcements/AnnouncementManager.js';

export const metadata = {
  command: '/whatsnew',
  description: 'view and dismiss CLI announcements',
  implemented: true,
};

export interface WhatsNewContext {
  announcementManager?: AnnouncementManagerContract;
}

function toModalOption(announcement: CliAnnouncement): ModalOption {
  const details = [
    ...announcement.bodyLines,
    ...(announcement.cta ? [announcement.cta] : []),
  ];
  return {
    label: announcement.headline,
    value: announcement.id,
    ...(details.length > 0 ? { description: details.join('\n') } : {}),
  };
}

export async function whatsnew(ctx: WhatsNewContext): Promise<string | null> {
  const manager = ctx.announcementManager;
  if (!manager) {
    return 'Announcements are unavailable in this session.';
  }

  await manager.refresh();

  while (true) {
    const active = manager.getActive();
    if (active.length === 0) {
      return 'No new announcements.';
    }

    await Promise.all(active.map((announcement) => manager.markSeen(announcement.id)));
    const selected = await showModal({
      title: "What's new",
      options: active.map(toModalOption),
      maxVisible: active.length,
      hint: '↑↓ move  ·  enter dismiss  ·  esc close',
    });
    if (!selected) {
      return null;
    }
    await manager.dismiss(selected.value);
  }
}
