/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import {
  returningStartupLogoRows,
  returningStartupViewport,
} from '../../src/testing/scenarios/startupReturningBrandingScenario.js';
import {
  clearComposerInput,
  createMockAuthServer,
  createMockOpenRouterServer,
  createTempAutohandHome,
  exitInteractive,
  expectCleanExit,
  launchBuiltAutohand,
  type MockAuthServer,
  type MockOpenRouterServer,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';

let session: Session | undefined;
let state: TuistoryTempState | undefined;
let auth: MockAuthServer | undefined;
let provider: MockOpenRouterServer | undefined;

afterEach(async () => {
  session?.close();
  await Promise.all([auth?.close(), provider?.close(), state?.cleanup()]);
  session = undefined;
  state = undefined;
  auth = undefined;
  provider = undefined;
});

describe('returning authenticated startup branding', () => {
  it.each([
    { cols: 80, rows: 24, logoRows: 9 },
    { cols: 120, rows: 32, logoRows: 11 },
  ])('keeps the complete logo and editable composer visible at $cols×$rows', async ({ cols, rows, logoRows }) => {
    auth = await createMockAuthServer();
    provider = await createMockOpenRouterServer('Returning startup is ready.');
    state = await createTempAutohandHome({
      config: {
        openrouter: { baseUrl: provider.baseUrl },
        agent: { autoMemory: false, maxIterations: 2, sessionRetryLimit: 0 },
        network: { maxRetries: 0, retryDelay: 0 },
        ui: {
          mouseComposerCursor: false,
          promptSuggestions: false,
          showCompletionNotification: false,
          terminalBell: false,
        },
      },
    });
    session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      cols,
      rows,
      env: {
        AUTOHAND_NO_BANNER: undefined,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        COLUMNS: String(cols),
        LINES: String(rows),
        AUTOHAND_API_URL: auth.baseUrl,
        AUTOHAND_AUTH_URL: auth.baseUrl,
        AUTOHAND_AUTH_API_URL: `${auth.baseUrl}/v1/auth`,
      },
    });
    await session.text({ timeout: 10_000, waitFor: (text) => text.includes('❯') });
    await new Promise<void>((resolve) => setTimeout(resolve, 350));

    const viewport = returningStartupViewport(session);
    const printedLogo = returningStartupLogoRows(session.getRawOutput());
    const visibleLogo = returningStartupLogoRows(viewport);
    expect(session.getTerminalData().cols).toBe(cols);
    expect(session.getTerminalData().rows).toBe(rows);
    expect(visibleLogo, viewport).toHaveLength(logoRows);
    expect(printedLogo).toHaveLength(logoRows);
    expect(visibleLogo).toEqual(printedLogo);
    expect(viewport).toContain('Autohand');
    expect(viewport).toContain('openai/gpt-4o-mini');
    expect(viewport).toContain('/help');
    expect(viewport).toContain('❯');

    await session.type('startup draft');
    await session.press('left');
    await session.type('X');
    await session.text({ timeout: 5_000, waitFor: (text) => text.includes('❯ startup drafXt') });
    expect(returningStartupLogoRows(returningStartupViewport(session))).toEqual(printedLogo);
    expect(returningStartupLogoRows(session.getRawOutput())).toEqual(printedLogo);

    await clearComposerInput(session);
    await exitInteractive(session);
    expectCleanExit(session);
    expect(session.getTerminalData().cursorVisible).toBe(true);
  });
});
