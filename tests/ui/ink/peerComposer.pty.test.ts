import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { PtyDriver } from '../../../src/testing/drivers/pty-driver.js';

const terminals: PtyDriver[] = [];
afterEach(() => { for (const terminal of terminals.splice(0)) terminal.close(); });

describe('peer composer real PTY', () => {
  it('preserves the fallback draft and exact recipient across an automatic-turn handoff', async () => {
    const terminal = new PtyDriver();
    terminals.push(terminal);
    terminal.launch('bun', [path.resolve('src/testing/scenarios/peerComposerScenario.tsx'), '--fallback', '--suspend-draft']);
    await terminal.waitFor('❯');
    terminal.type(':bu');
    await terminal.waitFor(':builder');
    terminal.type('\t');
    terminal.type('Preserve this draft');
    await terminal.waitFor('PEER_DRAFT_SUSPENDED');
    await terminal.waitFor('❯ :builder Preserve this draft');
    terminal.enter();
    await terminal.waitFor('incarnation changed');
    terminal.ctrlC(); terminal.ctrlC(); terminal.ctrlC();
  });

  it('recalls a fallback message without retargeting a replacement alias', async () => {
    const terminal = new PtyDriver();
    terminals.push(terminal);
    terminal.launch('bun', [path.resolve('src/testing/scenarios/peerComposerScenario.tsx'), '--fallback', '--history-churn']);
    await terminal.waitFor('❯');
    terminal.type(':bu');
    await terminal.waitFor(':builder');
    terminal.type('\t');
    terminal.type('Retain the original recipient');
    await terminal.waitFor('❯ :builder Retain the original recipient');
    terminal.enter();
    await terminal.waitFor('To :builder · accepted');
    terminal.up();
    await terminal.waitFor('❯ :builder Retain the original recipient');
    terminal.enter();
    await terminal.waitFor('incarnation changed');
    terminal.ctrlC(); terminal.ctrlC(); terminal.ctrlC();
  });

  it('selects a different fallback recipient with arrow navigation', async () => {
    const terminal = new PtyDriver();
    terminals.push(terminal);
    terminal.launch('bun', [path.resolve('src/testing/scenarios/peerComposerScenario.tsx'), '--fallback']);
    await terminal.waitFor('❯');
    terminal.type(':');
    await terminal.waitFor(':reviewer');
    terminal.down();
    terminal.type('\t');
    terminal.type('arrow-selected message');
    terminal.enter();
    await terminal.waitFor('To :reviewer · accepted');
    terminal.ctrlC(); terminal.ctrlC();
  });

  it.each([false, true])('uses an explicit machine scope in the %s fallback terminal', async fallback => {
    const terminal = new PtyDriver();
    terminals.push(terminal);
    terminal.launch('bun', [path.resolve('src/testing/scenarios/peerComposerScenario.tsx'), ...(fallback ? ['--fallback'] : [])]);
    await terminal.waitFor(fallback ? '❯' : 'PEER_COMPOSER_READY');
    terminal.type(':rem');
    await terminal.waitFor('No matching peers');
    terminal.type('\u001b[Z');
    await terminal.waitFor('repository');
    terminal.type('\u001b[Z');
    await terminal.waitFor(':remote');
    terminal.type('\t');
    terminal.type('across workspaces');
    await terminal.waitFor('❯ :remote across workspaces');
    terminal.enter();
    await terminal.waitFor('To :remote · accepted');
    terminal.ctrlC(); terminal.ctrlC();
  });

  it('uses the shared recipient binding and direct-send route in the fallback prompt', async () => {
    const terminal = new PtyDriver();
    terminals.push(terminal);
    terminal.launch('bun', [path.resolve('src/testing/scenarios/peerComposerScenario.tsx'), '--fallback']);
    await terminal.waitFor('❯');
    terminal.type(':bu');
    terminal.type('\t');
    await terminal.waitFor(':builder', 3_000);
    terminal.type('fallback terminal message');
    await terminal.waitFor('fallback terminal message');
    terminal.enter();
    await terminal.waitFor('accepted');
    expect(terminal.snapshot()).not.toContain('Direct messages must bypass');
    terminal.ctrlC();
    await terminal.waitFor('Press Ctrl+C again');
    terminal.ctrlC();
  });

  it('selects with keyboard, sends while busy, records the receipt and exits with Ctrl+C', async () => {
    const terminal = new PtyDriver();
    terminals.push(terminal);
    terminal.launch('bun', [path.resolve('src/testing/scenarios/peerComposerScenario.tsx')]);
    await terminal.waitFor('PEER_COMPOSER_READY');
    terminal.type(':bu');
    await terminal.waitFor(':builder');
    terminal.enter();
    await terminal.waitFor(/❯ :builder\s*\n/);
    terminal.type('real terminal message');
    await terminal.waitFor('❯ :builder real terminal message');
    terminal.enter();
    await terminal.waitFor('accepted');
    expect(terminal.snapshot()).toContain(':builder');
    expect(terminal.snapshot()).not.toContain('Direct messages must bypass');
    terminal.ctrlC();
    await terminal.waitFor('Press Ctrl+C again');
    terminal.ctrlC();
  });
});
