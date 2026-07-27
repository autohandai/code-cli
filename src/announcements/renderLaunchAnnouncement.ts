/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CliAnnouncement } from './AnnouncementContent.js';

export function renderLaunchAnnouncement(
  announcement: CliAnnouncement,
  activeCount: number,
): string[] {
  const lines = [
    ` ◆ What's new  ·  ${announcement.headline}`,
    ...announcement.bodyLines.map((line) => `   ${line}`),
  ];
  if (announcement.cta) {
    lines.push(`   ${announcement.cta}`);
  }
  if (activeCount > 1) {
    lines.push(`   +${activeCount - 1} more · /whatsnew`);
  }
  return lines;
}
