/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PACKAGE_DIR = path.resolve('examples/extensions/autohand.document-factory');
const RUNTIME = pathToFileURL(path.join(PACKAGE_DIR, 'dist/extension.mjs')).href;

interface RegisteredCommand {
  command: string;
  description: string;
  execute(context: { args: string[] }): string;
}

async function loadFactory() {
  const mod = await import(RUNTIME);
  let registered: RegisteredCommand | undefined;
  const api = {
    commands: {
      register(cmd: RegisteredCommand) {
        registered = cmd;
      },
    },
  };
  const deactivate = await mod.activate(api);
  if (!registered) {
    throw new Error('activate() did not register a command');
  }
  return { command: registered, deactivate };
}

describe('autohand.document-factory /factory command', () => {
  it('registers the /factory slash command with a description', async () => {
    const { command } = await loadFactory();
    expect(command.command).toBe('/factory');
    expect(command.description).toMatch(/TRD/);
    expect(command.description).toMatch(/PRD/);
    expect(command.description).toMatch(/ADR/);
  });

  it('defaults to the full pipeline when no args are given', async () => {
    const { command } = await loadFactory();
    const out = command.execute({ args: [] });
    expect(out).toContain('staff-level software engineer');
    expect(out).toContain('Technical Requirements Document (TRD)');
    expect(out).toContain('Product Requirements Document (PRD)');
    expect(out).toContain('Implementation Design');
    expect(out).toContain('Test-Driven Development plan (TDD)');
    expect(out).toContain('Implementation (Code)');
    expect(out).toContain('Architecture Decision Records (ADRs)');
    expect(out).toContain('docs/trd.md');
    expect(out).toContain('docs/prd.md');
    expect(out).toContain('docs/implementation-design.md');
    expect(out).toContain('docs/tdd.md');
    expect(out).toContain('docs/adr/');
    expect(out).toContain('delegate_task');
    expect(out).toContain('delegate_parallel');
  });

  it('seeds a named feature into the instruction', async () => {
    const { command } = await loadFactory();
    const out = command.execute({ args: ['checkout'] });
    expect(out).toContain('**checkout**');
  });

  it('targets a single artifact with /factory trd', async () => {
    const { command } = await loadFactory();
    const out = command.execute({ args: ['trd'] });
    expect(out).toContain('Technical Requirements Document (TRD)');
    expect(out).not.toContain('Product Requirements Document (PRD)');
    expect(out).not.toContain('Architecture Decision Records (ADRs)');
  });

  it('targets a subset with /factory trd prd design', async () => {
    const { command } = await loadFactory();
    const out = command.execute({ args: ['trd', 'prd', 'design'] });
    expect(out).toContain('Technical Requirements Document (TRD)');
    expect(out).toContain('Product Requirements Document (PRD)');
    expect(out).toContain('Implementation Design');
    expect(out).not.toContain('Test-Driven Development plan (TDD)');
    expect(out).not.toContain('Architecture Decision Records (ADRs)');
  });

  it('resolves aliases (technical, product, impl, tests, architecture)', async () => {
    const { command } = await loadFactory();
    const out = command.execute({ args: ['technical', 'product', 'impl', 'tests', 'architecture'] });
    expect(out).toContain('Technical Requirements Document (TRD)');
    expect(out).toContain('Product Requirements Document (PRD)');
    expect(out).toContain('Implementation Design');
    expect(out).toContain('Test-Driven Development plan (TDD)');
    expect(out).toContain('Architecture Decision Records (ADRs)');
  });

  it('treats an unknown positional as the feature name and runs the full pipeline', async () => {
    const { command } = await loadFactory();
    const out = command.execute({ args: ['billing'] });
    expect(out).toContain('**billing**');
    expect(out).toContain('Technical Requirements Document (TRD)');
    expect(out).toContain('Architecture Decision Records (ADRs)');
  });

  it('returns a cleanup function from activate', async () => {
    const { deactivate } = await loadFactory();
    expect(typeof deactivate).toBe('function');
  });
});

describe('autohand.document-factory fresh-process discovery (real runtime host)', () => {
  let tempRoot: string;

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-doc-factory-'));
  });

  afterAll(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('is discovered and dispatchable through the real runtime host', async () => {
    const { ExtensionRegistry } = await import('../../src/extensions/ExtensionRegistry.js');
    const { ExtensionRuntimeHost } = await import('../../src/extensions/ExtensionRuntimeHost.js');
    const { ExtensionService } = await import('../../src/extensions/ExtensionService.js');

    const userRoot = path.join(tempRoot, 'extensions');
    const service = new ExtensionService({ userRoot });
    await service.install(PACKAGE_DIR, { scope: 'user', trust: true });
    const registry = new ExtensionRegistry({ userRoot });
    const snapshot = await registry.load();

    const installed = snapshot.extensions.find((ext) => ext.manifest.id === 'autohand.document-factory');
    expect(installed).toBeDefined();
    expect(installed?.manifest.version).toBe('1.0.0');
    expect(installed?.trusted).toBe(true);

    const host = new ExtensionRuntimeHost();
    try {
      const diagnostics = await host.sync(snapshot);
      expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);

      const command = host.getCommand('/factory');
      expect(command).toBeDefined();
      expect(command?.description).toMatch(/TRD/);

      const out = command?.execute({ args: ['checkout'] });
      expect(out).toContain('**checkout**');
      expect(out).toContain('Technical Requirements Document (TRD)');
      expect(out).toContain('delegate_task');
    } finally {
      await host.deactivateAll();
    }
  });
});
