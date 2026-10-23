import { describe, expect, it } from 'vitest';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runMcpStartupFailureScenario } from '../../src/testing/scenarios/mcpStartupScenario.js';
import { createTempAutohandHome, exitInteractive, launchBuiltAutohand } from './helpers/autohandTuistory.js';

describe('MCP startup recovery guidance', () => {
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
