/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('index top-level command reporting', () => {
  it('reads the config for command telemetry without creating account settings', () => {
    // The preAction hook runs for every command, including `discovery` and
    // `--bare`, which must not leave a config file behind on a machine that
    // never opted into Autohand settings. Reading with defaults is enough to
    // learn whether telemetry is enabled.
    const source = readFileSync(path.resolve(process.cwd(), 'src/index.ts'), 'utf8');
    const hookStart = source.indexOf("program.hook('preAction'");
    const hookEnd = source.indexOf('\n});', hookStart);
    const hook = source.slice(hookStart, hookEnd);

    expect(hook).toContain('reportCliCommand(');
    expect(hook).toMatch(/loadConfig:\s*\(\)\s*=>\s*loadConfig\(undefined,\s*undefined,\s*\{[^}]*createIfMissing:\s*false/);
    expect(hook).toMatch(/initializeTheme:\s*false/);
  });
});
