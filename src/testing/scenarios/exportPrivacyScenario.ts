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
  // Export output is printed before the modal has restored the composer.
  // Prove input is live again before the caller sends Ctrl+C for teardown.
  await session.waitForText('Plan, search, build anything', { timeout: 10_000 });
  await session.type('export input restored');
  await session.waitForText('❯ export input restored', { timeout: 10_000 });
  return session.readAll();
}
