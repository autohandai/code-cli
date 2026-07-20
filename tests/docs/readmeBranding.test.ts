import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('README branding', () => {
  const supportedDocsLinks = [
    '[English](docs/config-reference.md)',
    '[日本語](docs/config-reference_ja.md)',
    '[简体中文](docs/config-reference_zh.md)',
    '[繁體中文](docs/config-reference_zh-tw.md)',
    '[한국어](docs/config-reference_ko.md)',
    '[Deutsch](docs/config-reference_de.md)',
    '[Español](docs/config-reference_es.md)',
    '[Français](docs/config-reference_fr.md)',
    '[Italiano](docs/config-reference_it.md)',
    '[Polski](docs/config-reference_pl.md)',
    '[Русский](docs/config-reference_ru.md)',
    '[Português (Brasil)](docs/config-reference_ptBR.md)',
    '[Türkçe](docs/config-reference_tr.md)',
    '[Čeština](docs/config-reference_cs.md)',
    '[Magyar](docs/config-reference_hu.md)',
    '[हिन्दी](docs/config-reference_hi.md)',
    '[Bahasa Indonesia](docs/config-reference_id.md)',
  ];
  const supportedConfigReferencePaths = supportedDocsLinks.map((link) => (
    link.slice(link.lastIndexOf('(') + 1, -1)
  ));

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

  it('documents cloud-sync trust boundaries in every supported config reference', async () => {
    const root = process.cwd();

    for (const docsPath of supportedConfigReferencePaths) {
      const configReference = await readFile(join(root, docsPath), 'utf8');
      const paragraphs = configReference.split(/\r?\n\s*\r?\n/);
      const pathPolicy = paragraphs.find((paragraph) => paragraph.includes('POSIX'));
      const credentialPolicy = paragraphs.find((paragraph) => paragraph.includes('`Authorization`'));

      expect(configReference, `${docsPath} must document relative POSIX path containment`)
        .toContain('POSIX');
      expect(pathPolicy, `${docsPath} must document Windows-style path rejection`)
        .toContain('Windows');
      expect(credentialPolicy, `${docsPath} must document credential header containment`)
        .toContain('`Authorization`');
      expect(credentialPolicy, `${docsPath} must document cross-origin HTTPS transfers`)
        .toContain('HTTPS');
      expect(configReference.indexOf(credentialPolicy ?? ''))
        .toBeGreaterThan(configReference.indexOf(pathPolicy ?? ''));
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
