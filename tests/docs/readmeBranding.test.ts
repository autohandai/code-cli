import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('README branding', () => {
  const supportedDocsLinks = [
    '[English](https://docs.autohand.ai/en)',
    '[日本語](https://docs.autohand.ai/ja)',
    '[简体中文](https://docs.autohand.ai/zh-cn)',
    '[繁體中文](https://docs.autohand.ai/zh-tw)',
    '[한국어](https://docs.autohand.ai/ko)',
    '[Deutsch](https://docs.autohand.ai/de)',
    '[Español](https://docs.autohand.ai/es)',
    '[Français](https://docs.autohand.ai/fr)',
    '[Italiano](https://docs.autohand.ai/it)',
    '[Polski](https://docs.autohand.ai/pl)',
    '[Русский](https://docs.autohand.ai/ru)',
    '[Português (Brasil)](https://docs.autohand.ai/pt-br)',
    '[Türkçe](https://docs.autohand.ai/tr)',
    '[Čeština](https://docs.autohand.ai/cs)',
    '[Magyar](https://docs.autohand.ai/hu)',
    '[हिन्दी](https://docs.autohand.ai/hi)',
    '[Bahasa Indonesia](https://docs.autohand.ai/id)',
  ];

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

  it('links to the Bahasa Indonesia configuration reference', async () => {
    const root = process.cwd();
    const readme = await readFile(join(root, 'README.md'), 'utf8');
    const indonesianConfigReference = await readFile(join(root, 'docs/config-reference_id.md'), 'utf8');

    expect(readme).toContain('[Bahasa Indonesia](docs/config-reference_id.md)');
    expect(indonesianConfigReference).toContain('# Referensi Konfigurasi Autohand');
  });

  it('uses the current community links', async () => {
    const readme = await readFile(join(process.cwd(), 'README.md'), 'utf8');

    expect(readme).toContain('[Follow us on X](https://x.com/autohandai)');
    expect(readme).toContain('[Join Discord](https://discord.gg/ZM3TCtwCwG)');
    expect(readme).toContain('https://discord.gg/ZM3TCtwCwG');
    expect(readme).not.toContain('https://discord.com/invite/MWTNudaj8E');
    expect(readme).not.toContain('https://twitter.com/autohandai');
  });

  it('links supported README languages to localized docs', async () => {
    const readme = await readFile(join(process.cwd(), 'README.md'), 'utf8');

    for (const docsLink of supportedDocsLinks) {
      expect(readme).toContain(docsLink);
    }
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
