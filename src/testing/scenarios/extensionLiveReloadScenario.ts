/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import type { Session } from 'tuistory';
import { waitForTerminalScreen } from '../drivers/tuistory-driver.js';

export const LIVE_EXTENSION_ID = 'autohand.live-reload';

export async function writeLiveExtension(root: string): Promise<void> {
  await fs.ensureDir(path.join(root, 'dist'));
  await fs.writeJson(path.join(root, 'autohand.extension.json'), {
    schemaVersion: 1, extensionApi: 1, id: LIVE_EXTENSION_ID, name: 'Live reload',
    version: '1.0.0', description: 'Exercises in-session extension edits.',
    contributes: { runtime: ['dist/extension.mjs'] },
  });
  await fs.writeFile(path.join(root, 'dist/value.mjs'), 'export const value = "ONE";');
  await fs.writeFile(path.join(root, 'dist/extension.mjs'), `
import { value } from './value.mjs';
export function activate(api) {
  const {React, Ink} = api.ui;
  api.commands.register({command:'/live-value', description:'Show the current value', execute:()=> 'LIVE_RESPONSE_'+value});
  api.commands.register({command:'/live-view', description:'Open the current view', execute:ctx=>ctx.ui.open('live.dashboard')});
  api.ui.registerView({id:'live.dashboard',title:'Live dashboard',component:()=>React.createElement(Ink.Text,null,'LIVE_VIEW_'+value)});
  api.ui.setStatusLine({segments:[{id:'live-state',text:'live:'+value,color:'success'}]});
  api.keybindings.register({key:'ctrl+k',command:'/live-view'});
}
`);
}

export async function driveExtensionLiveReload(session: Session, root: string): Promise<{ draft: string; repaired: string }> {
  await session.waitForText('live:ONE', { timeout: 20_000 });
  await session.type('preserve my extension draft');
  await fs.writeFile(path.join(root, 'dist/value.mjs'), 'export const value = "TWO";');
  const draft = await waitForTerminalScreen(session, {
    timeout: 15_000,
    waitFor: (screen) => screen.includes('live:TWO') && screen.includes('❯ preserve my extension draft'),
  });
  await session.press(['ctrl', 'c']);
  await waitForTerminalScreen(session, { timeout: 5_000, waitFor: (screen) => !screen.includes('❯ preserve my extension draft') });
  await session.type('/live-value');
  await session.press('enter');
  await session.waitForText('LIVE_RESPONSE_TWO', { timeout: 10_000 });
  await session.press(['ctrl', 'k']);
  await session.waitForText('LIVE_VIEW_TWO', { timeout: 10_000 });
  await fs.writeFile(path.join(root, 'dist/value.mjs'), 'export const value = "THREE";');
  await new Promise<void>((resolve) => setTimeout(resolve, 600));
  const modal = await session.text({ immediate: true });
  if (!modal.includes('LIVE_VIEW_TWO') || modal.includes('LIVE_VIEW_THREE')) throw new Error(`Reload replaced an active view:\n${modal}`);
  await session.press('escape');
  await session.waitForText('live:THREE', { timeout: 15_000 });
  const entry = path.join(root, 'dist/extension.mjs');
  const workingSource = await fs.readFile(entry, 'utf8');
  await fs.writeFile(entry, 'export function activate() { throw new Error("unfinished live edit"); }');
  await session.waitForText('keeping the last working version', { timeout: 15_000 });
  await session.type('/live-value');
  await session.press('enter');
  await session.waitForText('LIVE_RESPONSE_THREE', { timeout: 10_000 });
  await fs.writeFile(path.join(root, 'dist/value.mjs'), 'export const value = "FOUR";');
  await fs.writeFile(entry, workingSource);
  const repaired = await waitForTerminalScreen(session, { timeout: 15_000, waitFor: (screen) => screen.includes('live:FOUR') });
  await session.type('/extensions reload');
  await session.press('enter');
  await session.waitForText('Extensions refreshed.', { timeout: 10_000 });
  return { draft, repaired };
}

export async function driveExtensionEditDuringTurn(session: Session, root: string, waitForRequest: () => Promise<void>): Promise<string> {
  await session.waitForText('live:ONE', { timeout: 20_000 });
  await session.type('finish the current turn');
  await session.press('enter');
  await waitForRequest();
  await fs.writeFile(path.join(root, 'dist/value.mjs'), 'export const value = "AFTER_TURN";');
  await session.type('preserve while finishing');
  await new Promise<void>((resolve) => setTimeout(resolve, 650));
  const active = await session.text({ immediate: true });
  if (!active.includes('live:ONE') || active.includes('live:AFTER_TURN')) throw new Error(`Reload interrupted an active turn:\n${active}`);
  await session.waitForText('LIVE_TURN_FINISHED', { timeout: 20_000 });
  return waitForTerminalScreen(session, { timeout: 15_000,
    waitFor: (screen) => screen.includes('live:AFTER_TURN') && screen.includes('❯ preserve while finishing') });
}
