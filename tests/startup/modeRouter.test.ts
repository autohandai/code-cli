/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  applyStartupInteractionMode,
  resolveAgentLaunchMode,
  resolveInternalLaunchMode,
  resolvePostAuthLaunchMode,
  resolveProtocolLaunchMode,
  resolveStartupInteractionMode,
} from '../../src/startup/modeRouter.js';
import type { CLIOptions } from '../../src/types.js';

describe('CLI mode routing', () => {
  it('routes no-argument launches to the interactive agent', () => {
    expect(resolveProtocolLaunchMode({})).toBe('standard');
    expect(resolveInternalLaunchMode({})).toBe('standard');
    expect(resolvePostAuthLaunchMode({
      argv: [],
      stdinIsTTY: true,
    })).toBe('standard');
    expect(resolveAgentLaunchMode({})).toBe('interactive');
  });

  it('routes prompt launches to command mode', () => {
    expect(resolveAgentLaunchMode({ prompt: 'review this' })).toBe('command');
  });

  it.each([
    ['rpc', 'rpc'],
    ['acp', 'acp'],
    ['interactive', 'standard'],
  ] as const)('routes --mode %s to %s', (mode, expected) => {
    expect(resolveProtocolLaunchMode({ mode })).toBe(expected);
  });

  it('routes teammate children through the internal pre-auth boundary', () => {
    expect(resolveInternalLaunchMode({
      mode: 'teammate',
    })).toBe('teammate');
  });

  it('preserves standalone, interactive, and unavailable auto-mode decisions', () => {
    expect(resolvePostAuthLaunchMode({
      autoMode: 'automate this',
      argv: ['--auto-mode'],
      stdinIsTTY: false,
    })).toBe('auto-standalone');
    expect(resolvePostAuthLaunchMode({
      argv: ['--auto-mode'],
      stdinIsTTY: true,
    })).toBe('auto-interactive');
    expect(resolvePostAuthLaunchMode({
      argv: ['--auto-mode'],
      stdinIsTTY: false,
    })).toBe('auto-unavailable');
  });

  it('preserves final agent-mode precedence', () => {
    expect(resolveAgentLaunchMode({
      fork: 'session-id',
      prompt: 'prompt',
      resumeSessionId: 'resume-id',
    })).toBe('fork');
    expect(resolveAgentLaunchMode({
      prompt: 'prompt',
      resumeSessionId: 'resume-id',
    })).toBe('command');
    expect(resolveAgentLaunchMode({ resumeSessionId: 'resume-id' })).toBe('resume');
  });
});

describe('startup interaction mode', () => {
  const interactive = { options: {}, isInteractiveTerminal: true } as const;

  it('starts interactive terminal sessions in auto mode by default', () => {
    expect(resolveStartupInteractionMode(interactive)).toBe('automode');
  });

  it('keeps an explicit --auto-mode request in auto mode even when the config opts out', () => {
    expect(resolveStartupInteractionMode({
      options: { interactiveAutoMode: true },
      configuredMode: 'default',
      isInteractiveTerminal: true,
    })).toBe('automode');
  });

  it.each([
    [{ plan: true }, 'plan'],
    [{ yolo: 'allow:read_file' }, 'yolo'],
    [{ restricted: true }, 'default'],
    [{ dryRun: true }, 'default'],
    [{ unrestricted: true }, 'default'],
    [{ yes: true }, 'default'],
  ] as const)('lets the explicit flag %j decide the mode (%s)', (options, expected) => {
    expect(resolveStartupInteractionMode({ ...interactive, options })).toBe(expected);
  });

  it.each([
    [{ prompt: 'review this' }, true],
    [{ mode: 'rpc' }, true],
    [{ mode: 'acp' }, true],
    [{ mode: 'teammate' }, true],
    [{}, false],
  ] as const)('never escalates the non-interactive launch %j (tty=%s)', (options, isInteractiveTerminal) => {
    expect(resolveStartupInteractionMode({
      options,
      configuredMode: 'automode',
      isInteractiveTerminal,
    })).toBe('default');
  });

  it.each(['restricted', 'external'] as const)(
    'respects a %s permission config over the auto default',
    (permissionMode) => {
      expect(resolveStartupInteractionMode({ ...interactive, permissionMode })).toBe('default');
      expect(resolveStartupInteractionMode({
        ...interactive,
        permissionMode,
        configuredMode: 'automode',
      })).toBe('default');
    },
  );

  it('does not treat the wizard-written interactive permission mode as an opt-out', () => {
    expect(resolveStartupInteractionMode({ ...interactive, permissionMode: 'interactive' })).toBe('automode');
  });

  it.each(['default', 'plan', 'automode', 'yolo'] as const)(
    'honours ui.defaultInteractionMode = %s',
    (configuredMode) => {
      expect(resolveStartupInteractionMode({ ...interactive, configuredMode })).toBe(configuredMode);
    },
  );

  it('maps the resolved mode onto the launch options the agent reads', () => {
    const auto: CLIOptions = {};
    applyStartupInteractionMode(auto, 'automode');
    expect(auto).toEqual({ interactiveAutoMode: true });

    const plan: CLIOptions = {};
    applyStartupInteractionMode(plan, 'plan');
    expect(plan).toEqual({ plan: true });

    const yolo: CLIOptions = {};
    applyStartupInteractionMode(yolo, 'yolo');
    expect(yolo).toEqual({ yolo: 'allow:*' });

    const explicitYolo: CLIOptions = { yolo: 'allow:read_file' };
    applyStartupInteractionMode(explicitYolo, 'yolo');
    expect(explicitYolo).toEqual({ yolo: 'allow:read_file' });

    const standard: CLIOptions = { restricted: true };
    applyStartupInteractionMode(standard, 'default');
    expect(standard).toEqual({ restricted: true });
  });
});
