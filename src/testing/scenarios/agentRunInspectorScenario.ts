/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';

export async function openAgentRunInspector(session: Session): Promise<void> {
  await session.type('/agents view');
  await session.text({ timeout: 10_000, waitFor: (text) => text.includes('/agents view') });
  await session.press('enter');
  await session.text({ timeout: 15_000, waitFor: (text) => text.includes('Session agents') && text.includes('Enter details') });
}

export async function inspectAndCancelFixtureAgent(session: Session): Promise<string> {
  await openAgentRunInspector(session);
  session.writeRaw('\u001b[200~HIDDEN_INSPECTOR_PASTE\u001b[201~');
  await session.press('enter');
  await session.text({ timeout: 10_000, waitFor: (text) => text.includes('FAST_AGENT_PROOF') && text.includes('54 tokens') });
  const completedDetail = await session.text({ immediate: true });
  await session.press('escape');
  await session.text({ timeout: 5_000, waitFor: (text) => text.includes('Enter details') });
  await session.press('down');
  await session.press('c');
  await session.text({ timeout: 5_000, waitFor: (text) => text.includes('Cancel inspector-slow?') });
  await session.press('y');
  await session.text({ timeout: 15_000, waitFor: (text) => text.includes('inspector-slow · cancelled') });
  const cancelledDetail = await session.text({ immediate: true });
  if (cancelledDetail.includes('waiting for agent to stop')) {
    throw new Error('Cancelled agent still reports an outstanding stop request.');
  }
  await session.press('escape');
  await session.text({ timeout: 5_000, waitFor: (text) => text.includes('Enter details') });
  await session.press('down');
  await session.press('enter');
  await session.text({ timeout: 10_000, waitFor: (text) => text.includes('inspector-error · failed') && text.includes('Error:') });
  return completedDetail;
}
