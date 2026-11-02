import { describe, expect, it, vi } from 'vitest';
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runMcpStartupFailureScenario, typeWhileMcpStarts } from '../../src/testing/scenarios/mcpStartupScenario.js';
import { createTempAutohandHome, exitInteractive, launchBuiltAutohand } from './helpers/autohandTuistory.js';

describe('MCP startup recovery guidance', () => {
  it.skipIf(process.platform === 'win32')('accepts a fullscreen draft while MCP is silent and before an expensive Git snapshot', async () => {
    const state = await createTempAutohandHome({ config: {
      features: { fullScreenMode: true, automaticSpecialists: false },
      ui: { promptSuggestions: false }, agent: { autoMemory: false },
    } });
    const bin = path.join(state.autohandHome, 'bin');
    const snapshotStarted = path.join(state.autohandHome, 'snapshot.started');
    const snapshotRelease = path.join(state.autohandHome, 'snapshot.release');
    const mcpStarted = path.join(state.autohandHome, 'mcp.started');
    const mcpScript = path.join(state.autohandHome, 'silent-mcp.cjs');
    await mkdir(bin);
    await writeFile(path.join(bin, 'git'), [
      '#!/usr/bin/env node',
      'const fs = require("node:fs");',
      'const args = process.argv.slice(2);',
      'if (args.join(" ") === "ls-files -z --cached --others --exclude-standard") {',
      `fs.writeFileSync(${JSON.stringify(snapshotStarted)}, "started");`,
      'const deadline = Date.now() + 10_000;',
      `while (!fs.existsSync(${JSON.stringify(snapshotRelease)}) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);`,
      '}',
      'const result = require("node:child_process").spawnSync("/usr/bin/git", args, { stdio: "inherit" });',
      'process.exit(result.status ?? 1);',
    ].join('\n'));
    await chmod(path.join(bin, 'git'), 0o755);
    await writeFile(mcpScript, `require("node:fs").writeFileSync(${JSON.stringify(mcpStarted)}, "started"); process.stdin.resume(); setInterval(() => {}, 1_000);`);
    const config = JSON.parse(await readFile(state.configPath, 'utf8')) as Record<string, unknown>;
    await writeFile(state.configPath, JSON.stringify({ ...config, mcp: { enabled: true, servers: [
      { name: 'silent-startup', transport: 'stdio', command: process.execPath, args: [mcpScript], autoConnect: true },
    ] } }));
    let session: Awaited<ReturnType<typeof launchBuiltAutohand>> | undefined;
    try {
      session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome, cwd: state.workspaceRoot, cols: 120, rows: 36, waitForData: false,
        env: { PATH: `${bin}:${process.env.PATH ?? ''}` },
      });
      await typeWhileMcpStarts(session);
      expect(session.getRawOutput()).toContain('\x1b[?1049h');
      await expect(access(snapshotStarted)).rejects.toMatchObject({ code: 'ENOENT' });
      await vi.waitFor(() => access(mcpStarted), { timeout: 5_000 });
      await exitInteractive(session);
    } finally {
      await writeFile(snapshotRelease, 'release');
      session?.close(); await session?.waitForExit(5_000);
      await state.cleanup();
    }
  }, 30_000);

  it.skipIf(process.platform === 'win32')('shows the Docker registry failure while preserving the configured launch target', async () => {
    const state = await createTempAutohandHome();
    const command = path.join(state.workspaceRoot, 'docker');
    await writeFile(command, '#!/bin/sh\nprintf "%s\\n" "docker: pull ghcr.io/github/github-mcp-server: denied: denied" >&2\nexit 125\n');
    await chmod(command, 0o755);
    const config = JSON.parse(await readFile(state.configPath, 'utf8')) as Record<string, unknown>;
    await writeFile(state.configPath, JSON.stringify({ ...config, mcp: { enabled: true, servers: [
      { name: 'github', transport: 'stdio', command, args: ['run', '-i', '--rm', 'ghcr.io/github/github-mcp-server'], autoConnect: false },
    ] } }));
    const before = JSON.parse(await readFile(state.configPath, 'utf8')) as { mcp: { servers: Array<Record<string, unknown>> } };
    let session: Awaited<ReturnType<typeof launchBuiltAutohand>> | undefined;
    try {
      session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome, cwd: state.workspaceRoot, cols: 120, rows: 36,
      });
      const screen = await runMcpStartupFailureScenario(session);
      expect(screen).toContain('GitHub MCP image pull was denied');
      expect(screen).not.toContain('Retry with newline framing failed');
      await exitInteractive(session);
      const after = JSON.parse(await readFile(state.configPath, 'utf8')) as { mcp: unknown };
      expect(after.mcp).toEqual({ ...before.mcp,
        servers: before.mcp.servers.map(server => ({ ...server, autoConnect: true })),
      });
    } finally { session?.close(); await state.cleanup(); }
  });
});
