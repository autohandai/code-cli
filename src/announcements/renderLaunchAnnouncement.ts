/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { t } from '../i18n/index.js';
import type { CliAnnouncement } from './AnnouncementContent.js';

export function renderLaunchAnnouncement(
  announcement: CliAnnouncement,
  activeCount: number,
): string[] {
  const lines = [
    ` ◆ ${t('announcements.launchLabel')}  ·  ${announcement.headline}`,
    ...announcement.bodyLines.map((line) => `   ${line}`),
  ];
  if (announcement.cta) {
    lines.push(`   ${announcement.cta}`);
  }
  if (activeCount > 1) {
    lines.push(`   ${t('announcements.moreHint', { count: activeCount - 1 })}`);
  }
  return lines;
}
