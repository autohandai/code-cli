/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'vitest';
import { PtyDriver } from '../../../src/testing/drivers/pty-driver.js';
import { runTypedMessageHistoryPtyScenario } from '../../../src/testing/scenarios/typedMessageHistoryScenario.js';

const terminal = new PtyDriver();
afterEach(() => terminal.close());

describe('composer history in node-pty', () => {
  it('submits recalled edits, restores a draft, and exits with Ctrl+C', async () => {
    terminal.launch(process.execPath, ['--import', 'tsx', 'src/testing/scenarios/typedMessageHistoryPtyScenario.tsx']);
    await runTypedMessageHistoryPtyScenario(terminal);
    expect(terminal.snapshot()).toContain('SUBMITTED 4: unfinished restored');
  });
});
