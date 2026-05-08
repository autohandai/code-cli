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

  it('invites developers to use the CLI-backed Code Agent SDK packages', async () => {
    const readme = await readFile(join(process.cwd(), 'README.md'), 'utf8');

    expect(readme).toContain('[Code Agent SDK](https://github.com/autohandai/code-agent-sdk-typescript)');
    expect(readme).toContain('The Agent SDK is available in multiple beta language packages.');
    expect(readme).toContain('TypeScript - this package, with Agent, Run, streaming, and JSON helpers.');
    expect(readme).toContain('Go - idiomatic Go package with context.Context, typed events, and channel-based streaming.');
    expect(readme).toContain('Python - async Python package with async for event streams and typed Pydantic models.');
    expect(readme).toContain('Java - Java 21 records, sealed events, and virtual-thread-ready APIs.');
    expect(readme).toContain(
      'Swift - SwiftPM package with Agent, Runner, async streams, tools, hooks, and permissions.'
    );
  });
});
