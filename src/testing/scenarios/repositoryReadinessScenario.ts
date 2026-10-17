/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';
import { stripVTControlCharacters } from 'node:util';

export async function reviewRepositoryReadinessScenario(session: Session): Promise<string> {
  await session.type('/readiness');
  await session.press('tab');
  await session.press('enter');
  await session.waitForText('Evidence: AGENTS.md', { timeout: 10_000 });
  await session.waitForText('/readiness apply 1', { timeout: 10_000 });
  const screen = stripVTControlCharacters(await session.text({ immediate: true }));
  const start = screen.lastIndexOf('Repository readiness');
  const evidence = 'Evidence: AGENTS.md';
  const end = screen.indexOf(evidence, start);
  if (start < 0 || end < 0) throw new Error('Repository readiness report was not visible');
  const snapshot = screen.slice(start, end + evidence.length).split('\n').map(line => line.trimEnd()).join('\n');
  await session.type('/readiness dismiss');
  await session.press('enter');
  await session.waitForText('Repository suggestions dismissed', { timeout: 10_000 });
  await session.type('/readiness apply 1');
  await session.press('enter');
  await session.waitForText('READINESS_OPT_IN_COMPLETE', { timeout: 15_000 });
  return snapshot;
}
