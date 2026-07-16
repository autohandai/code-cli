import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('ACP integration guide', () => {
  const root = process.cwd();
  const guidePath = join(root, 'docs/guides/ACP.md');

  it('documents the native launch contract and supported ADE setup paths', async () => {
    const guide = await readFile(guidePath, 'utf8');

    expect(guide).toContain('autohand --acp');
    expect(guide).toContain('"command": "/absolute/path/to/autohand"');
    expect(guide).toContain('"args": ["--acp"]');
    expect(guide).toContain('## Zed');
    expect(guide).toContain('## JetBrains IDEs');
    expect(guide).toContain('## JetBrains Air');
    expect(guide).toContain('## GitHub Copilot app');
    expect(guide).toContain('## Any ACP-compatible ADE');
    expect(guide).toContain('stdout is reserved for ACP protocol messages');
  });

  it('keeps every JSON configuration example valid', async () => {
    const guide = await readFile(guidePath, 'utf8');
    const jsonBlocks = [...guide.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => match[1]);

    expect(jsonBlocks.length).toBeGreaterThanOrEqual(3);
    for (const jsonBlock of jsonBlocks) {
      expect(() => JSON.parse(jsonBlock)).not.toThrow();
    }
  });

  it('is discoverable from the README and configuration reference', async () => {
    const [readme, configReference] = await Promise.all([
      readFile(join(root, 'README.md'), 'utf8'),
      readFile(join(root, 'docs/config-reference.md'), 'utf8'),
    ]);

    expect(readme).toContain('[ACP integration guide](docs/guides/ACP.md)');
    expect(configReference).toContain('[ACP integration guide](./guides/ACP.md)');
  });
});
