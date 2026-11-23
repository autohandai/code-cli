/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';

/**
 * Opens the `:` recipient picker, accepts the given alias with Tab, types the
 * message, and submits it. Resolves with the receipt frame.
 */
export async function sendMessageWithColonTrigger(session: Session, alias: string, message: string): Promise<string> {
  await session.type(':');
  await session.text({ timeout: 10_000, waitFor: (text) => text.includes(`:${alias}`) && text.includes('Tab to accept') });
  await session.type(alias.slice(0, 4));
  await session.text({ timeout: 5_000, waitFor: (text) => text.includes(`:${alias}`) });
  await session.press('tab');
  await session.text({ timeout: 5_000, waitFor: (text) => !text.includes('Tab to accept') && text.includes(`❯ :${alias}`) });
  await session.type(message);
  await session.press('enter');
  return session.text({ timeout: 10_000, waitFor: (text) => text.includes(`Message queued for ${alias}`) });
}

/**
 * Addresses a presence-only peer session through the `:` picker and resolves
 * with the frame holding the refusal, so a test can read the stated reason.
 */
export async function messagePresenceOnlyPeer(session: Session, message: string): Promise<{ picker: string; receipt: string }> {
  await session.type(':');
  const picker = await session.text({ timeout: 20_000, waitFor: (text) => text.includes(':peer-') && text.includes('Tab to accept') });
  await session.press('tab');
  await session.text({ timeout: 5_000, waitFor: (text) => !text.includes('Tab to accept') && text.includes('❯ :peer-') });
  await session.type(message);
  await session.press('enter');
  const receipt = await session.text({ timeout: 10_000, waitFor: (text) => text.includes('cannot receive messages') });
  return { picker, receipt };
}
