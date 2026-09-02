/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * `/model` routes through provider settings, Autohand Hosted/Local plans, and
 * the grouped provider list. Those transitions and section headings are
 * rendered by Ink, so only a real terminal run proves keyboard input, viewport
 * windowing, and cancellation reach the screen the user actually looks at.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import stripAnsi from 'strip-ansi';
import type { Session } from 'tuistory';
import {
  createTempAutohandHome,
  exitInteractive,
  launchBuiltAutohand,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const tempStates: TuistoryTempState[] = [];
const itOnAppleSilicon =
  process.platform === 'darwin' && process.arch === 'arm64' ? it : it.skip;

const configuredAutohandCloud = {
  provider: 'autohandai',
  features: { autohand_inference: true },
  autohandai: {
    plan: 'cloud',
    authMode: 'api-key',
    apiKey: 'autohand-tuistory-api-key',
    baseUrl: 'https://api.autohand.ai/v1',
    model: 'fantail',
  },
};

interface LaunchedInteractive {
  session: Session;
  state: TuistoryTempState;
}

interface LaunchInteractiveOptions {
  env?: Record<string, string | undefined>;
  prepare?: (
    state: TuistoryTempState,
  ) => Promise<Record<string, string | undefined> | undefined>;
}

afterEach(async () => {
  const unclosedSessions = sessions.splice(0);
  for (const session of unclosedSessions) {
    session.close();
  }
  await Promise.all(unclosedSessions.map((session) => session.waitForExit(2_000)));
  for (const state of tempStates.splice(0)) {
    await state.cleanup();
  }
});

async function launchInteractive(
  extraConfig: Record<string, unknown> = {},
  options: LaunchInteractiveOptions = {},
): Promise<LaunchedInteractive> {
  const state = await createTempAutohandHome({
    config: {
      ui: { promptSuggestions: false },
      customProviders: {
        'acme-gateway': {
          id: 'acme-gateway',
          displayName: 'Acme Gateway',
          apiFormat: 'openai-compatible',
          baseUrl: 'https://acme.example/v1',
          model: 'acme-code-1',
          apiKey: 'acme-key-long-enough',
          apiKeyRequired: true,
        },
      },
      ...extraConfig,
    },
  });
  tempStates.push(state);
  const preparedEnv = await options.prepare?.(state);

  const session = await launchBuiltAutohand(
    ['--path', state.workspaceRoot, '--config', state.configPath, '--yes'],
    {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      env: {
        ...options.env,
        ...preparedEnv,
      },
      waitForDataTimeout: 15_000,
    },
  );
  sessions.push(session);

  await session.text({
    timeout: 20_000,
    waitFor: (text) => text.includes('❯'),
  });
  return { session, state };
}

async function openConfiguredAutohandSettings(session: Session): Promise<string> {
  await session.type('/model');
  await session.press('enter');

  return await session.text({
    timeout: 30_000,
    waitFor: (text) => text.includes('Choose an Autohand plan'),
  });
}

async function returnToComposer(session: Session): Promise<string> {
  return await session.text({
    timeout: 30_000,
    waitFor: (text) => text.includes('❯'),
  });
}

async function closeInteractive(session: Session): Promise<void> {
  await exitInteractive(session);
  sessions.splice(sessions.indexOf(session), 1);
}

async function createCurrentLocalRuntimeFixture(
  state: TuistoryTempState,
): Promise<Record<string, string | undefined>> {
  const fakeBinDir = path.join(state.autohandHome, 'fake-bin');
  const commandLog = path.join(state.autohandHome, 'local-runtime-commands.log');
  await mkdir(fakeBinDir, { recursive: true });

  const commands = {
    uv: `#!/bin/sh
printf 'uv %s\\n' "$*" >> "$AUTOHAND_TUI_COMMAND_LOG"
if [ "$1" = "tool" ] && [ "$2" = "list" ]; then
  echo 'mlx-lm v0.31.3'
  exit 0
fi
exit 91
`,
    llmfit: `#!/bin/sh
printf 'llmfit %s\\n' "$*" >> "$AUTOHAND_TUI_COMMAND_LOG"
if [ "$1" = "--version" ]; then
  echo 'llmfit 1.1.12'
  exit 0
fi
if [ "$1" = "recommend" ]; then
  echo '{"models":[{"id":"mlx-community/Qwen2.5-Coder-7B-Instruct-4bit","parameter_count":"7B","memory_required_gb":8,"estimated_tps":42,"score":91}]}'
  exit 0
fi
exit 92
`,
    'mlx_lm.server': `#!/bin/sh
printf 'mlx_lm.server %s\\n' "$*" >> "$AUTOHAND_TUI_COMMAND_LOG"
exit 93
`,
  };

  for (const [name, contents] of Object.entries(commands)) {
    const commandPath = path.join(fakeBinDir, name);
    await writeFile(commandPath, contents);
    await chmod(commandPath, 0o755);
  }

  return {
    HOME: state.autohandHome,
    PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
    AUTOHAND_TUI_COMMAND_LOG: commandLog,
  };
}

/** Walks `/model` from the composer to the grouped provider list. */
async function openProviderList(session: Session): Promise<string> {
  await session.type('/model');
  await session.press('enter');

  // The active provider is configured, so /model opens its settings menu first.
  await session.text({
    timeout: 30_000,
    waitFor: (text) => text.includes('Change provider'),
  });
  await session.type('3');

  return await session.text({
    timeout: 30_000,
    waitFor: (text) => text.includes('Choose an LLM provider'),
  });
}

describe('/model provider and Autohand plan journeys Tuistory', () => {
  it('renders a direct plan action with the established modal controls for a Cloud user', async () => {
    const { session } = await launchInteractive(configuredAutohandCloud);
    const settings = await openConfiguredAutohandSettings(session);

    expect(settings).toContain('What would you like to change?');
    expect(settings).toContain('Change model only');
    expect(settings).toContain('Choose an Autohand plan');
    expect(settings).toContain('Change provider');
    expect(settings).toMatch(/▸\s+1\.\s+Change model only/u);
    expect(settings).toContain('↑↓ Navigate');
    expect(settings).toContain('↵ Select');
    expect(settings).toContain('1-9 Shortcut');
    expect(settings).toContain('ESC Cancel');
    expect(settings.split('\n').filter((line) => line.includes('2. Choose an Autohand plan'))).toHaveLength(1);

    await session.press('escape');
    const composer = await returnToComposer(session);
    expect(composer).toContain('Autohand AI, fantail');

    await closeInteractive(session);
  });

  it('supports arrow-key navigation into the plan chooser and cancellation back to Cloud', async () => {
    const { session } = await launchInteractive(configuredAutohandCloud);
    await openConfiguredAutohandSettings(session);

    await session.press('down');
    const movedSettings = await session.text({
      timeout: 30_000,
      waitFor: (text) => /▸\s+2\.\s+Choose an Autohand plan/u.test(text),
    });
    expect(movedSettings).toMatch(/▸\s+2\.\s+Choose an Autohand plan/u);
    await session.press('enter');

    const plans = await session.text({
      timeout: 30_000,
      waitFor: (text) => text.includes('Hosted') && text.includes('Local'),
    });
    expect(plans).toMatch(/▸\s+1\.\s+Hosted/u);
    expect(plans).toContain('Use Autohand-hosted Fantail and Moa models at api.autohand.ai');
    expect(plans).toContain('Install MLX locally, choose a coding model your Mac can run');

    await session.press('down');
    const localSelected = await session.text({
      timeout: 30_000,
      waitFor: (text) => /▸\s+2\.\s+Local/u.test(text),
    });
    expect(localSelected).toMatch(/▸\s+2\.\s+Local/u);

    await session.press('escape');
    const composer = await returnToComposer(session);
    expect(composer).toContain('Configuration cancelled');
    expect(composer).toContain('Autohand AI, fantail');

    await closeInteractive(session);
  });

  it('keeps the Hosted model picker reachable through the direct plan action', async () => {
    const { session } = await launchInteractive(configuredAutohandCloud);
    await openConfiguredAutohandSettings(session);

    await session.type('2');
    const plans = await session.text({
      timeout: 30_000,
      waitFor: (text) => text.includes('Hosted') && text.includes('Local'),
    });
    expect(plans).toContain('Choose an Autohand plan');
    expect(plans).toContain('Hosted');
    expect(plans).toContain('Local');

    await session.type('1');
    const models = await session.text({
      timeout: 30_000,
      waitFor: (text) => text.includes('Select a model'),
    });
    expect(models).toContain('Fantail');
    expect(models).toContain('Moa');
    expect(models).toContain('↑↓ Navigate');

    await session.press('escape');
    const composer = await returnToComposer(session);
    expect(composer).toContain('Autohand AI, fantail');

    await closeInteractive(session);
  });

  itOnAppleSilicon(
    'reaches local recommendations without installing or starting a model server',
    async () => {
      const { session, state } = await launchInteractive(configuredAutohandCloud, {
        prepare: createCurrentLocalRuntimeFixture,
      });
      await openConfiguredAutohandSettings(session);

      await session.type('2');
      await session.text({
        timeout: 30_000,
        waitFor: (text) => text.includes('Hosted') && text.includes('Local'),
      });
      const localSetupOutput: string[] = [];
      const stopRecording = session.subscribe((chunk) => localSetupOutput.push(chunk));
      await session.type('2');

      const models = await session.text({
        timeout: 30_000,
        waitFor: (text) => text.includes('Choose a local coding model'),
      });
      stopRecording();
      expect(models).toContain('Qwen2.5 Coder 7B');
      expect(models).toContain('7B coding model');
      expect(models).toContain('8 GB');
      expect(models).toContain('42 tok/s estimated');
      expect(models).toContain('llmfit score 91');

      const interactionTranscript = stripAnsi(localSetupOutput.join(''));
      expect(interactionTranscript).toContain('5% Checking Apple Silicon MLX support');
      expect(interactionTranscript).toContain('42% Detecting local coding models for this Mac');

      await session.press('escape');
      const composer = await returnToComposer(session);
      expect(composer).toContain('Configuration cancelled');
      expect(composer).toContain('Autohand AI, fantail');

      const commandLog = await readFile(
        path.join(state.autohandHome, 'local-runtime-commands.log'),
        'utf8',
      );
      expect(commandLog).toContain('uv tool list');
      expect(commandLog).toContain('llmfit --version');
      expect(commandLog).toContain('llmfit recommend --json -n 50 --runtime mlx');
      expect(commandLog).not.toContain('tool install');
      expect(commandLog).not.toContain('mlx_lm.server');

      const savedConfig = JSON.parse(await readFile(state.configPath, 'utf8')) as {
        provider?: string;
        autohandai?: { plan?: string; model?: string };
      };
      expect(savedConfig.provider).toBe('autohandai');
      expect(savedConfig.autohandai).toEqual(expect.objectContaining({
        plan: 'cloud',
        model: 'fantail',
      }));

      await closeInteractive(session);
    },
  );

  it('separates Autohand AI from third-party providers at the top of the list', async () => {
    const { session } = await launchInteractive();

    const rendered = await openProviderList(session);

    expect(rendered).toContain('Choose an LLM provider');
    expect(rendered).toContain('Autohand AI');
    expect(rendered).toContain('Third-party providers');

    const autohandHeading = rendered.indexOf('Autohand AI');
    const firstEntry = rendered.indexOf('1. ');
    const thirdPartyHeading = rendered.indexOf('Third-party providers');
    expect(autohandHeading).toBeGreaterThanOrEqual(0);
    expect(firstEntry).toBeGreaterThan(autohandHeading);
    expect(thirdPartyHeading).toBeGreaterThan(firstEntry);

    await session.press('escape');
    await closeInteractive(session);
  });

  it('shows the Custom providers section with the configured endpoint and the add row', async () => {
    const { session } = await launchInteractive();

    await openProviderList(session);

    // One Up press wraps the cursor to the last row, scrolling the viewport to
    // the bottom of the list where the custom section lives.
    await session.press('up');

    const rendered = await session.text({
      timeout: 30_000,
      waitFor: (text) => text.includes('Custom providers'),
    });

    expect(rendered).toContain('Custom providers');
    expect(rendered).toContain('Acme Gateway');
    expect(rendered).toContain('New provider');
    // The scrolled viewport still names the section its first visible row is in.
    expect(rendered).toContain('Third-party providers');

    await session.press('escape');
    await closeInteractive(session);
  });

  it('opens the Autohand AI model picker directly when that provider is already configured', async () => {
    const { session } = await launchInteractive({
      autohandai: {
        plan: 'cloud',
        authMode: 'api-key',
        apiKey: 'autohand-tuistory-api-key',
        baseUrl: 'https://api.autohand.ai/v1',
        model: 'fantail',
      },
    });

    await openProviderList(session);
    await session.type('1');

    const rendered = await session.text({
      timeout: 30_000,
      waitFor: (text) => text.includes('Select a model') || text.includes('What would you like to change?'),
    });

    expect(rendered).toContain('Select a model');
    expect(rendered).not.toContain('What would you like to change?');
    expect(rendered).toContain('Fantail');
    expect(rendered).toContain('Moa');

    await session.press('escape');
    await closeInteractive(session);
  });
});
