/** @license Apache-2.0 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildLocalWorkMap,
  parseWorkMapHarnesses,
  renderWorkMap,
  writeWorkMapOutput,
} from '../../src/traces/localWorkMap.js';
import { deriveWorkMap } from '../../src/traces/workMap.js';
import type { LoadedConfig } from '../../src/types.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('local Work Map surface', () => {
  it('requires explicit monitoring and map consent before scanning', async () => {
    const map = vi.fn();
    await expect(buildLocalWorkMap({ traces: { enabled: false } } as LoadedConfig, {}, undefined, {
      module: { map },
    })).rejects.toThrow('Enable local trace monitoring');
    await expect(buildLocalWorkMap({ traces: { enabled: true } } as LoadedConfig, {}, undefined, {
      module: { map },
    })).rejects.toThrow('Enable local trace monitoring');
    expect(map).not.toHaveBeenCalled();
  });

  it('validates harness filters and delegates a bounded request', async () => {
    const expected = deriveWorkMap([], { since: '7d', coverage: [] });
    const map = vi.fn().mockResolvedValue(expected);
    const request = { since: '7d', harnesses: parseWorkMapHarnesses('autohand,codex') };
    const result = await buildLocalWorkMap({
      traces: { consentVersion: 1, enabled: true },
    } as LoadedConfig, request, undefined, {
      module: { map },
    });

    expect(result).toBe(expected);
    expect(map).toHaveBeenCalledWith(request, undefined);
    expect(() => parseWorkMapHarnesses('unknown-agent')).toThrow('Unknown trace agent');
  });

  it('renders and atomically writes aggregate-only output', async () => {
    const map = deriveWorkMap([], { since: '30d', coverage: [] });
    const directory = await mkdtemp(path.join(os.tmpdir(), 'autohand-work-map-'));
    temporaryDirectories.push(directory);
    const output = path.join(directory, 'map.json');

    expect(renderWorkMap(map)).toContain('no network requests');
    await writeWorkMapOutput(output, map);
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(map);
  });
});
