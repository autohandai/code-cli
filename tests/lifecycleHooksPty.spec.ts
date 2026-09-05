import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PtyDriver } from '../src/testing/drivers/pty-driver.js';

const terminals: PtyDriver[] = [];
afterEach(() => { for (const terminal of terminals.splice(0)) terminal.close(); });

describe('lifecycle hook node-pty terminal', () => {
  it('renders config and plugin counts, navigates down/up, and closes on Ctrl+C', async () => {
    const terminal = new PtyDriver();
    terminals.push(terminal);
    terminal.launch(process.execPath, ['--import', 'tsx', path.resolve('src/testing/scenarios/lifecycleHooksPty.ts')]);
    await terminal.waitFor('Lifecycle hooks from config and enabled plugins.');
    expect(terminal.snapshot()).toMatch(/session-start\s+2\s+2/);
    terminal.down();
    await terminal.waitFor(/▸ 2\.\s+session-end/);
    terminal.up();
    terminal.enter();
    await terminal.waitFor('Describe what this hook should do in plain English');
    expect(terminal.snapshot()).toContain('example.plugin');
    terminal.type('Log session start');
    terminal.enter();
    await terminal.waitFor('Creation cancelled. No hook installed.');
    terminal.ctrlC();
    await terminal.waitFor('HOOK_MENU_CLOSED');
  }, 20_000);
});
