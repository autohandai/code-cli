/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import stringWidth from 'string-width';
import { launchTuistorySession } from '../../src/testing/drivers/tuistory-driver.js';
import { isStartupLogoRow } from '../../src/testing/scenarios/startupReturningBrandingScenario.js';
import { expectCleanExit, waitForExit } from './helpers/autohandTuistory.js';

interface TerminalProfile {
  name: string;
  env: Record<string, string | undefined>;
}

const animatedProfiles: TerminalProfile[] = [
  { name: 'Ghostty', env: { TERM: 'xterm-ghostty', COLORTERM: 'truecolor', TERM_PROGRAM: 'ghostty' } },
  { name: 'iTerm2', env: { TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'iTerm.app' } },
  { name: 'Windows Terminal', env: { TERM: 'xterm-256color', COLORTERM: 'truecolor', WT_SESSION: 'branding-test-session' } },
  { name: '256-color', env: { TERM: 'xterm-256color', FORCE_COLOR: '2' } },
  { name: '16-color', env: { TERM: 'xterm', FORCE_COLOR: '1' } },
  { name: 'NO_COLOR monochrome', env: { TERM: 'xterm-256color', NO_COLOR: '1' } },
];

let session: Session | undefined;

afterEach(() => {
  session?.close();
  session = undefined;
});

function viewport(current: Session): string {
  const terminal = current.getTerminalData();
  return terminal.lines.slice(-terminal.rows)
    .map((line) => line.spans.map((span) => span.text).join('').trimEnd())
    .join('\n').trimEnd();
}

function artRows(screen: string): string[] {
  return screen.split('\n').filter(isStartupLogoRow);
}

function artColors(current: Session): string {
  const terminal = current.getTerminalData();
  return JSON.stringify([...new Set(terminal.lines.slice(-terminal.rows)
    .filter((line) => artRows(line.spans.map((span) => span.text).join('')).length > 0)
    .flatMap((line) => line.spans.filter((span) => span.text.trim()).map((span) => span.fg)))]);
}

function expectDefaultLogoStyle(current: Session): void {
  const terminal = current.getTerminalData();
  const spans = terminal.lines.slice(-terminal.rows)
    .filter((line) => isStartupLogoRow(line.spans.map((span) => span.text).join('')))
    .flatMap((line) => line.spans.filter((span) => span.text.trim()));
  expect(spans.length).toBeGreaterThan(0);
  for (const span of spans) {
    expect(span.fg).toBeNull();
    expect(span.bg).toBeNull();
    expect(span.flags).toBe(0);
  }
}

async function waitForScreen(current: Session, predicate: (screen: string) => boolean): Promise<string> {
  const deadline = Date.now() + 10_000;
  let screen = '';
  while (Date.now() < deadline) {
    screen = viewport(current);
    if (predicate(screen)) return screen;
    if (current.exitInfo) throw new Error(`Startup branding exited before the expected screen:\n${current.readAll()}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Startup branding did not render the expected screen:\n${screen}`);
}

async function launchBranding(env: Record<string, string | undefined> = {}, cols = 80, rows = 24, upgrade = false): Promise<Session> {
  session = await launchTuistorySession({
    command: process.execPath,
    args: [
      '--import', 'tsx', path.resolve('src/testing/scenarios/startupBrandingScenario.tsx'),
      `--TERM=${env.TERM ?? 'xterm-256color'}`,
      `--COLORTERM=${env.COLORTERM ?? ''}`,
      ...(upgrade ? ['--upgrade'] : []),
    ],
    cols,
    rows,
    waitForData: false,
    env: {
      ...process.env,
      CI: 'false',
      TERM: 'xterm-256color',
      COLORTERM: undefined,
      TERM_PROGRAM: undefined,
      WT_SESSION: undefined,
      NO_COLOR: undefined,
      FORCE_COLOR: undefined,
      AUTOHAND_REDUCED_MOTION: undefined,
      ...env,
    },
  });
  await waitForScreen(session, (screen) => screen.includes(upgrade ? 'New version available!' : 'Sign in to continue.')
    && screen.includes('Exit') && screen.includes('ESC') && screen.includes('Cancel'));
  return session;
}

describe('startup branding in real terminals', () => {
  it.each(animatedProfiles)('floats the compact monochrome mark while keeping the menu stationary in $name', async ({ env }) => {
    const current = await launchBranding(env);
    const initialScreen = viewport(current);
    const initialArt = artRows(initialScreen);
    const initialColors = artColors(current);
    const outputStart = current.getRawOutput().length;
    expect(initialArt.length).toBeGreaterThanOrEqual(3);
    expectDefaultLogoStyle(current);
    expect(initialScreen.match(/(?:^|\n)\s*autohand\s*(?=\n|$)/gu)).toHaveLength(1);

    const deadline = Date.now() + 2_000;
    while (artRows(viewport(current)).join('\n') === initialArt.join('\n') && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    expect(artRows(viewport(current))).not.toEqual(initialArt);
    expectDefaultLogoStyle(current);
    expect(artColors(current)).toBe(initialColors);
    expect(JSON.parse(initialColors)).toHaveLength(1);
    const changedFrame = await waitForScreen(current, (screen) => screen.includes('ESC Cancel'));
    expect(changedFrame.slice(changedFrame.indexOf('autohand'))).toBe(initialScreen.slice(initialScreen.indexOf('autohand')));
    await new Promise<void>((resolve) => setTimeout(resolve, 700));
    const laterFrame = await waitForScreen(current, (screen) => screen.includes('ESC Cancel'));
    expect(laterFrame.slice(laterFrame.indexOf('autohand'))).toBe(initialScreen.slice(initialScreen.indexOf('autohand')));
    expect(laterFrame.split('\n').length).toBe(initialScreen.split('\n').length);
    expect(Math.max(...artRows(laterFrame).map(line => line.trimEnd().length))).toBeLessThanOrEqual(49);
    const frameOutput = current.getRawOutput().slice(outputStart);
    expect(frameOutput.length).toBeGreaterThan(0);
    expect(frameOutput).not.toContain('\x1b[3J');
    expect(frameOutput.length).toBeLessThan(200_000);
    expect(current.getTerminalData().totalLines).toBeLessThanOrEqual(current.currentRows);

    current.sendKey('down');
    await waitForScreen(current, (screen) => /▸.*Exit/u.test(screen));
    current.sendKey('up');
    await waitForScreen(current, (screen) => /▸.*Login/u.test(screen));
    current.sendKey('enter');
    await waitForExit(current);
    expectCleanExit(current);
    expect(current.readAll()).toContain('BRANDING_SELECTED:login');
    expect(current.readAll()).toContain(`BRANDING_TERMINAL:${env.TERM}:${env.COLORTERM ?? ''}`);
    expect(current.getTerminalData().cursorVisible).toBe(true);
  });

  it.each([
    { name: 'dumb terminal', env: { TERM: 'dumb' }, hasColor: false },
    { name: 'reduced motion', env: { AUTOHAND_REDUCED_MOTION: '1', COLORTERM: 'truecolor' }, hasColor: true },
  ])('keeps readable, static branding for $name', async ({ env, hasColor }) => {
    const current = await launchBranding(env);
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    const first = viewport(current);
    const outputStart = current.getRawOutput().length;
    expect(artRows(first).length).toBeGreaterThanOrEqual(3);
    expectDefaultLogoStyle(current);
    await new Promise<void>((resolve) => setTimeout(resolve, 800));
    expect(viewport(current)).toBe(first);
    expect(current.getRawOutput().slice(outputStart)).toBe('');
    if (hasColor) {
      expect(current.getRawOutput()).toMatch(/\x1b\[(?:38;|3[0-7]m|9[0-7]m)/u);
    } else {
      expect(current.getRawOutput()).not.toMatch(/\x1b\[(?:38;|3[0-7]m|9[0-7]m)/u);
    }
    current.sendKey('down');
    await waitForScreen(current, (screen) => /▸.*Exit/u.test(screen));
    current.sendKey('enter');
    await waitForExit(current);
    expectCleanExit(current);
    expect(current.readAll()).toContain('BRANDING_SELECTED:exit');
  });

  it.each(['escape', 'ctrl+c'] as const)('cancels animated startup with %s and restores the cursor', async (key) => {
    const current = await launchBranding({ COLORTERM: 'truecolor' });
    current.sendKey(key === 'escape' ? 'escape' : ['ctrl', 'c']);
    await waitForExit(current);
    expectCleanExit(current);
    expect(current.readAll()).toContain('BRANDING_SELECTED:cancel');
    expect(current.getTerminalData().cursorVisible).toBe(true);
  });

  it.each([
    { name: 'SS3 application Down', input: '\x1bOB', selection: 'exit' },
    { name: 'SS3 application Up after Down', input: '\x1bOA', selection: 'login' },
    { name: 'batched CSI Down and Enter', input: '\x1b[B\r', selection: 'exit' },
    { name: 'batched SS3 Down and Enter', input: '\x1bOB\r', selection: 'exit' },
    { name: 'batched SS3 Down Up and Enter', input: '\x1bOB\x1bOA\r', selection: 'login' },
  ])('keeps startup input consistent for $name', async ({ input, selection }) => {
    const current = await launchBranding({ NO_COLOR: '1' });
    if (input === '\x1bOA') {
      current.writeRaw('\x1bOB');
      await waitForScreen(current, (screen) => /▸.*Exit/u.test(screen));
    }
    current.writeRaw(input);
    if (!input.endsWith('\r')) {
      await waitForScreen(current, (screen) => new RegExp(`▸.*${selection === 'exit' ? 'Exit' : 'Login'}`, 'u').test(screen));
      current.sendKey('enter');
    }
    await waitForExit(current);
    expectCleanExit(current);
    expect(current.readAll()).toContain(`BRANDING_SELECTED:${selection}`);
    expect(current.getTerminalData().cursorVisible).toBe(true);
  });

  it('assembles split SS3 input before selecting the highlighted option', async () => {
    const current = await launchBranding({ NO_COLOR: '1' });
    current.writeRaw('\x1b');
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    current.writeRaw('OB');
    await waitForScreen(current, (screen) => /▸.*Exit/u.test(screen));
    current.sendKey('enter');
    await waitForExit(current);
    expectCleanExit(current);
    expect(current.readAll()).toContain('BRANDING_SELECTED:exit');
    expect(current.getTerminalData().cursorVisible).toBe(true);
  });

  it.each([
    { cols: 26, rows: 16, upgrade: false },
    { cols: 26, rows: 17, upgrade: true },
  ])('fits the full wrapped sign-in menu at $cols×$rows with upgrade=$upgrade', async ({ cols, rows, upgrade }) => {
    const current = await launchBranding({ NO_COLOR: '1' }, cols, rows, upgrade);
    const screen = await waitForScreen(current, (screen) => screen.includes('ESC') && screen.includes('Cancel'));
    expect(screen.match(/(?:^|\n)\s*autohand\s*(?=\n|$)/gu)).toHaveLength(1);
    expect(screen.split('\n').length).toBeLessThanOrEqual(rows);
    expect(screen.split('\n').every((line) => stringWidth(line) <= cols)).toBe(true);
    expect(current.getTerminalData().totalLines).toBeLessThanOrEqual(rows);
    expect(current.getRawOutput()).not.toContain('\x1b[3J');
    current.sendKey('down');
    await waitForScreen(current, (text) => upgrade ? /▸.*Upgrade/u.test(text) : /▸.*Exit/u.test(text));
    current.sendKey('enter');
    await waitForExit(current);
    expectCleanExit(current);
    expect(current.readAll()).toContain(`BRANDING_SELECTED:${upgrade ? 'upgrade' : 'exit'}`);
  });

  it('keeps the brand, sign-in choices, and help visible when resized to a narrow short terminal', async () => {
    const current = await launchBranding({ COLORTERM: 'truecolor' }, 120, 36);
    const wideArt = artRows(viewport(current));
    current.resize({ cols: 32, rows: 18 });
    const narrow = await waitForScreen(current, (screen) => screen.includes('Login') && screen.includes('Exit')
      && screen.includes('ESC') && artRows(screen).length > 0
      && artRows(screen).every((line) => stringWidth(line) <= 30));
    expect(artRows(narrow)).not.toEqual(wideArt);
    expect(narrow.split('\n').length).toBeLessThanOrEqual(18);

    current.resize({ cols: 32, rows: 12 });
    const small = await waitForScreen(current, (screen) => screen.includes('Login') && screen.includes('Exit')
      && screen.includes('ESC') && screen.match(/(?:^|\n)\s*autohand\s*(?=\n|$)/gu)?.length === 1);
    expect(small).toContain('Sign in to continue.');
    expect(small).toContain('ESC');
    expect(small.split('\n').length).toBeLessThanOrEqual(12);
    expect(small.split('\n').every((line) => stringWidth(line) <= 32)).toBe(true);
    expect(artRows(small)).not.toEqual(wideArt);
    expect(current.getRawOutput()).not.toContain('\x1b[3J');

    current.resize({ cols: 80, rows: 24 });
    await waitForScreen(current, (screen) => artRows(screen).length >= 3 && screen.includes('ESC'));
    current.sendKey('enter');
    await waitForExit(current);
    expectCleanExit(current);
    expect(current.readAll()).toContain('BRANDING_SELECTED:login');
  });

  it('renders the complete monochrome sign-in screen as a stable terminal snapshot', async () => {
    const current = await launchBranding({ NO_COLOR: '1', AUTOHAND_REDUCED_MOTION: '1' });
    expect(viewport(current)).toMatchInlineSnapshot(`
      "
                ⣀⣀⡀      ⢀⣀⣀      ⣀⣀⡀      ⢀⣀⣀
             ⢀⡴⠋⠉⠉⠉⠳⣄  ⣰⠞⠉⠉⠉⠙⢦⡀⢀⡴⠋⠉⠉⠉⠳⣆  ⣠⠞⠉⠉⠉⠙⢦⡀
             ⣼⠁·⣴⣶⡄·⢸⡆⢰⡇·⢠⣶⣦·⠈⡇⢸⠁·⣰⣶⡆·⢸⡆⢰⡇·⢠⣶⣦·⠈⣧·
             ⠸⣄·⠈⠛⠁·⡼⠁⠈⣧·⠈⠛⠋·⣰⠇⠸⣆·⠈⠛⠁·⣼⠁⠈⢧·⠈⠛⠋·⣠⠇·
              ⠈⠳⠦⠤⠶⠛⠁··⠈⠓⠶⠤⠴⠞⠁··⠈⠳⠦⠤⠶⠚⠁··⠈⠛⠶⠤⠴⠞⠁··
              ⢀⡴⠖⠒⠶⣤⡀· ⢀⡤⠶⠒⠲⢦⡀· ⢀⡴⠖⠒⠶⢤⡀· ⢀⣤⠶⠒⠲⢦⡀·
             ⢰⠋·⢀⣀⡀·⢳⡀⢀⡟·⢀⣠⡀·⠹⡆⢰⠏·⢀⣀⡀·⢻⡀⢀⡞··⣠⣀·⠙⡆
             ⢻⡀·⠻⡿⠇·⢸⠇⠸⡇·⠸⢿⠟·⢀⡇⢸⡀·⠻⡿⠇·⢸⠇⠸⡇·⠘⢿⠿·●•·
             ⠈⠳⣄⣀⣀⣀⡴⠋··⠹⢦⣀⣀⣀⣠⠞⠁⠈⠳⣄⣀⣀⣀⡴⠏··⠙⢦⣀⣀⣀••··
              ··⠉⠉⠁···  ·⠈⠉⠉······⠉⠉⠁···  ·⠈⠉⠉····
                 ···      ···      ···      ···

       autohand
       v0.8.2
       Sign in to continue.

       ▸ 1. Login
         2. Exit

       ↑↓ Navigate · ↵ Select · 1-9 Shortcut · ESC Cancel"
    `);
    current.sendKey('escape');
    await waitForExit(current);
    expectCleanExit(current);
  });
});
