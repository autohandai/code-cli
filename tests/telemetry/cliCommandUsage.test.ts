import { describe, expect, it, vi } from 'vitest';
import { buildCommandUseData, reportCliCommand } from '../../src/telemetry/commandUsage.js';

/**
 * Interactive slash commands are reported once, centrally, before dispatch.
 * Top-level commands never reach that runtime — they run and exit without an
 * agent — so every one of them was invisible until this existed.
 */
describe('top-level CLI command reporting', () => {
  const disabled = async () => ({ telemetry: { enabled: false } });

  it('reports nothing when telemetry is not enabled', async () => {
    const loadConfig = vi.fn(disabled);

    await reportCliCommand({ commandPath: ['login'], loadConfig, clientVersion: '0.8.2' });

    // The config is read, but nothing is constructed for a user who has not
    // opted in.
    expect(loadConfig).toHaveBeenCalledOnce();
  });

  it('never throws when config cannot be read', async () => {
    // Reporting a command must never be the reason the command fails.
    await expect(
      reportCliCommand({
        commandPath: ['mcp', 'connect'],
        loadConfig: async () => {
          throw new Error('config unreadable');
        },
        clientVersion: '0.8.2',
      }),
    ).resolves.toBeUndefined();
  });

  it('reports nothing for an empty command path', async () => {
    const loadConfig = vi.fn(disabled);

    await reportCliCommand({ commandPath: [], loadConfig, clientVersion: '0.8.2' });

    expect(loadConfig).not.toHaveBeenCalled();
  });
});

describe('command payload cardinality', () => {
  it('keeps the subcommand only when it is a known one', () => {
    // Free-form arguments carry paths, server names and prompts. An unknown
    // first argument must not become a telemetry dimension.
    const known = buildCommandUseData({
      command: 'mcp',
      args: ['connect', 'my-private-server'],
      knownSubcommands: ['connect', 'disconnect'],
      surface: 'cli',
    });
    expect(known).toEqual({ command: 'mcp', subcommand: 'connect', surface: 'cli' });

    const unknown = buildCommandUseData({
      command: 'mcp',
      args: ['/Users/someone/secret/path'],
      knownSubcommands: ['connect'],
      surface: 'cli',
    });
    expect(unknown).toEqual({ command: 'mcp', surface: 'cli' });
  });
})
