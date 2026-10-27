/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';

export async function runExportPrivacyScenario(session: Session, format: 'md' | 'json' | 'html'): Promise<string> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type('Read tool-output.txt and report when done.');
  await session.press('enter');
  await session.waitForText('EXPORT_FIXTURE_READY', { timeout: 20_000 });
  await session.type('/export');
  await session.press('enter');
  await session.waitForText('Export format:', { timeout: 10_000 });
  for (let i = 0; i < ['md', 'json', 'html'].indexOf(format); i++) await session.press('down');
  await session.press('enter');
  if (format !== 'json') {
    await session.waitForText('Include tool outputs?', { timeout: 5_000 });
    await session.press('enter');
    await session.waitForText('Include table of contents?', { timeout: 5_000 });
    await session.press('enter');
  }
  await session.waitForText('Save as:', { timeout: 5_000 });
  await session.press('enter');
  await session.waitForText('Secrets redacted:', { timeout: 10_000 });
  return session.readAll();
}

export async function exitAfterExport(session: Session): Promise<void> {
  if (session.exitInfo) return;
  try {
    await session.waitForText('❯', { timeout: 10_000 });
    if (session.exitInfo) return;
    await session.type('/exit');
    await session.text({ timeout: 10_000, waitFor: screen =>
      screen.split('\n').some(line => line.includes('❯') && line.includes('/exit')) });
    await session.press('enter');
  } catch (error) {
    if (!session.exitInfo) throw error;
  }
}
