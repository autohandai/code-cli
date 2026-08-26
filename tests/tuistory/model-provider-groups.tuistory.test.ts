/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * `/model` lists every provider in one modal. The section headings that split
 * Autohand AI from third-party and custom providers are rendered by the Ink
 * modal itself, so only a real terminal run proves the headings survive the
 * viewport windowing and reach the screen the user actually looks at.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import {
  createTempAutohandHome,
  exitInteractive,
  launchBuiltAutohand,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const tempStates: TuistoryTempState[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    session.close();
  }
  for (const state of tempStates.splice(0)) {
    await state.cleanup();
  }
});

async function launchInteractive(extraConfig: Record<string, unknown> = {}): Promise<Session> {
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

  const session = await launchBuiltAutohand(
    ['--path', state.workspaceRoot, '--config', state.configPath, '--yes'],
    {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForDataTimeout: 15_000,
    },
  );
  sessions.push(session);

  await session.text({
    timeout: 20_000,
    waitFor: (text) => text.includes('❯'),
  });
  return session;
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

describe('/model provider sections Tuistory', () => {
  it('separates Autohand AI from third-party providers at the top of the list', async () => {
    const session = await launchInteractive();

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
    await exitInteractive(session);
    sessions.splice(sessions.indexOf(session), 1);
  });

  it('shows the Custom providers section with the configured endpoint and the add row', async () => {
    const session = await launchInteractive();

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
    await exitInteractive(session);
    sessions.splice(sessions.indexOf(session), 1);
  });

  it('opens the Autohand AI model picker directly when that provider is already configured', async () => {
    const session = await launchInteractive({
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
    await exitInteractive(session);
    sessions.splice(sessions.indexOf(session), 1);
  });
});
