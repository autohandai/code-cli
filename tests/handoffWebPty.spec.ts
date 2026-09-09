import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { PtyDriver } from '../src/testing/drivers/pty-driver.js';
import { seedTransferScenario, transferScenarioId } from '../src/testing/scenarios/transferScenario.js';
import { createTempAutohandHome, type TuistoryTempState } from './tuistory/helpers/autohandTuistory.js';

let terminal: PtyDriver | undefined, state: TuistoryTempState | undefined;
afterEach(async () => { terminal?.close(); await state?.cleanup(); });

it('hands a resumed Web conversation back from a real CLI terminal and returns to input', async () => {
  state = await createTempAutohandHome({ config: { ui: { promptSuggestions: false } } });
  const preload = await seedTransferScenario(state.autohandHome);
  terminal = new PtyDriver();
  terminal.launch('/usr/bin/env', [`AUTOHAND_HOME=${state.autohandHome}`, 'AUTOHAND_SKIP_AUTH=1', `TSX_TSCONFIG_PATH=${path.resolve('tsconfig.json')}`, `NODE_OPTIONS=--import=${preload}`, process.execPath, '--import', import.meta.resolve('tsx'), path.resolve('src/index.ts'), 'transfer', transferScenarioId, '--account', 'personal_fixture', '--config', state.configPath, '--offline', '--accept'], { cwd: state.workspaceRoot, cols: 160, rows: 40 });
  await terminal.waitFor(`Resumed session web-${transferScenarioId}`, 30_000);
  await terminal.waitFor('❯');
  terminal.type('/handoff web --no-open');
  await terminal.waitFor('/handoff web --no-open');
  terminal.enter();
  await terminal.waitFor('private transfer expires in 24 hours', 15_000);
  const uploaded = JSON.parse(await fs.readFile(path.join(state.autohandHome, 'handoff-upload.json'), 'utf8'));
  expect(uploaded.snapshot.source).toBe('cli');
  expect(uploaded.snapshot.messages.map((message: { content: string }) => message.content)).toEqual(['Keep the parser history', 'The parser context is saved.']);
  const previous = terminal.snapshot().length;
  terminal.type('/handoff web --help');
  await terminal.waitFor('/handoff web --help', 10_000, previous);
  terminal.enter();
  await terminal.waitFor('Usage: /handoff web', 10_000, previous);
}, 60_000);
