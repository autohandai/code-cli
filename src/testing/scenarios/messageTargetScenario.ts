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
