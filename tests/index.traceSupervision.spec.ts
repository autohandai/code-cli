/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('index startup trace supervision', () => {
  it('only blocks startup on ahtraces reconciliation outside long-lived protocol modes', () => {
    // `src/index.ts` runs its command on import, so the hook is checked at the
    // source level. ACP and RPC hosts answer their client handshake before
    // reconciliation finishes; reconciliation never throws and nothing after
    // the hook reads its result, so letting it finish in the background is safe.
    const source = readFileSync(path.resolve(process.cwd(), 'src/index.ts'), 'utf8');
    const hookStart = source.indexOf("program.hook('preAction'");
    const hookEnd = source.indexOf('\n});', hookStart);
    const hook = source.slice(hookStart, hookEnd);

    expect(hook).toMatch(/if \(shouldAwaitAhTracesReconcile\(\{ mode, acp \}\)\) await traceSupervision;/);
    expect(hook).not.toMatch(/^\s*await traceSupervision;/m);
  });
});
