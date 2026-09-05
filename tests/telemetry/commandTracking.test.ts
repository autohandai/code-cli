/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { buildCommandUseData } from '../../src/telemetry/commandUsage.js';
import { TelemetryManager } from '../../src/telemetry/TelemetryManager.js';

describe('command usage telemetry', () => {
  it('records a known subcommand and surface without arbitrary arguments', () => {
    const data = buildCommandUseData({
      command: '/review',
      args: ['security', 'private/customer-a', '--focus', 'credential leak'],
      knownSubcommands: ['changes', 'code', 'architecture', 'security'],
      surface: 'json_rpc',
    });

    expect(data).toEqual({
      command: '/review',
      subcommand: 'security',
      surface: 'json_rpc',
    });
    expect(JSON.stringify(data)).not.toContain('customer-a');
    expect(JSON.stringify(data)).not.toContain('credential leak');
  });

  it('normalizes a two-word command into command and subcommand dimensions', () => {
    expect(buildCommandUseData({
      command: '/skills install',
      args: ['@private/skill'],
      surface: 'interactive',
    })).toEqual({
      command: '/skills',
      subcommand: 'install',
      surface: 'interactive',
    });
  });

  it('does not classify a path or free-form argument as a subcommand', () => {
    expect(buildCommandUseData({
      command: '/review',
      args: ['src/private-customer'],
      knownSubcommands: ['changes', 'code', 'architecture', 'security'],
      surface: 'acp',
    })).toEqual({
      command: '/review',
      surface: 'acp',
    });
  });

  it('emits only the privacy-safe command dimensions', async () => {
    const telemetry = new TelemetryManager({ enabled: false });
    const trackEvent = vi.spyOn(
      telemetry as unknown as { trackEvent: (...args: unknown[]) => Promise<void> },
      'trackEvent',
    ).mockResolvedValue(undefined);

    await telemetry.trackCommand({
      command: '/review',
      args: ['private/customer-a'],
      subcommand: 'security',
      surface: 'cli',
    });

    expect(trackEvent).toHaveBeenCalledWith('command_use', {
      command: '/review',
      subcommand: 'security',
      surface: 'cli',
    });
  });
});
