/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';

export interface ApplyPatchDiffScenarioOptions {
  instruction: string;
  completionMarker: string;
}

export async function runApplyPatchDiffScenario(
  session: Session,
  options: ApplyPatchDiffScenarioOptions,
): Promise<{ output: string; rawOutput: string }> {
  await session.text({
    timeout: 20_000,
    waitFor: (text) => text.includes('❯'),
  });
  await session.type(options.instruction);
  await session.press('enter');
  await session.waitForText(options.completionMarker, { timeout: 30_000 });

  return {
    output: session.readAll(),
    rawOutput: session.getRawOutput(),
  };
}
