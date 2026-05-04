import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('README branding', () => {
  it('uses Autohand Code CLI in public-facing README and package description copy', async () => {
    const root = process.cwd();
    const readme = await readFile(join(root, 'README.md'), 'utf8');
    const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      description: string;
    };

    expect(packageJson.description).toContain('Autohand Code CLI');
    expect(readme).toContain('Autohand Code CLI is a fast, terminal-native AI coding agent');
    expect(readme).not.toContain('## Why Autohand?');
    expect(readme).not.toContain('Autohand handles the rest.');
    expect(readme).not.toContain('Scale Autohand across');
    expect(readme).not.toContain('Use Autohand directly');
    expect(readme).not.toContain('Autohand includes 40+ tools');
    expect(readme).not.toContain('Autohand is designed with security in mind');
  });

  it('links to the Autohand Code CLI extension guide', async () => {
    const readme = await readFile(join(process.cwd(), 'README.md'), 'utf8');

    expect(readme).toContain(
      '[Extending Autohand Code CLI](docs/extending.md) - Build tools, skills, hooks, MCP servers, and integrations'
    );
  });
});
