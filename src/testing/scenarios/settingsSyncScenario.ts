/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** All requests are intercepted; the built CLI never reaches a real account. */
export async function prepareSettingsSyncFailureScenario(directory: string): Promise<string> {
  const preload = path.join(directory, 'settings-sync-fetch.mjs');
  await writeFile(preload, `
const user = { id: 'tuistory-test-user', email: 'tuistory@example.com', name: 'Tuistory Test' };
globalThis.fetch = async input => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.pathname === '/api/auth/me' || url.pathname === '/v1/auth/me') return Response.json({ user });
  if (url.pathname === '/v1/sync/manifest') return Response.json({ error: '413 fixture: session store unavailable' }, { status: 413 });
  return Response.json({ error: 'Network disabled in settings-sync scenario' }, { status: 503 });
};
`);
  return pathToFileURL(preload).href;
}
