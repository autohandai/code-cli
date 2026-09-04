/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';

export interface UndoSafetyScenarioOptions {
  instruction: string;
  completionMarker: string;
}

export async function runUndoSafetyScenario(
  session: Session,
  options: UndoSafetyScenarioOptions,
): Promise<string> {
  await session.text({
    timeout: 20_000,
    waitFor: (text) => text.includes('❯'),
  });
  await session.type(options.instruction);
  await session.press('enter');
  await session.waitForText(options.completionMarker, { timeout: 20_000 });
  await session.type('/undo');
  await session.press('enter');
  await session.waitForText('Undo complete. Ready for new instructions.', { timeout: 10_000 });
  return session.readAll();
}
