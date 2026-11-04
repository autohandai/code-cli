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

export async function prepareMissingSettingsSyncDownloadScenario(directory: string, options: { missingSession?: boolean } = {}): Promise<string> {
  const preload = path.join(directory, 'settings-sync-missing-download.mjs');
  await writeFile(preload, `
const user = { id: 'tuistory-test-user', email: 'tuistory@example.com', name: 'Tuistory Test' };
const file = { path: ${JSON.stringify(options.missingSession ? 'sessions/missing/conversation.jsonl' : 'agents/missing-cloud-agent.md')}, hash: '0'.repeat(64), size: 3, modifiedAt: '2026-11-03T00:00:00.000Z' };
const files = ${options.missingSession === true} ? [file, { ...file, path: 'agents/healthy-cloud-agent.md' }] : [file];
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.pathname === '/api/auth/me' || url.pathname === '/v1/auth/me') return Response.json({ user });
  if (url.pathname === '/v1/skill-library') return Response.json({}, { status: 404 });
  if (url.pathname.startsWith('/v1/coding-agent/')) return Response.json({ success: true, revision: 0, connectors: [], profiles: [] });
  if (url.pathname === '/v1/sync/manifest') return Response.json({ manifest: { version: 1, userId: user.id, lastModified: file.modifiedAt, files, checksum: 'fixture' } });
  if (url.pathname === '/v1/sync/download') return Response.json({ downloadUrls: Object.fromEntries(files.map(entry => [entry.path, 'https://sync.example.invalid/v1/sync/files/' + entry.path])) });
  if (url.pathname === '/v1/sync/files/' + file.path) return Response.json({ error: 'File not found in storage' }, { status: 404 });
  if (url.pathname.startsWith('/v1/sync/files/')) return new Response('healthy cloud agent');
  if (url.pathname === '/v1/sync/upload') return Response.json({ uploadUrls: Object.fromEntries(JSON.parse(options.body).files.map(file => [file, 'https://sync.example.invalid/v1/sync/upload-file/' + file])) });
  if (url.pathname.startsWith('/v1/sync/upload-file/')) return new Response(null, { status: 200 });
  if (url.pathname === '/v1/sync/complete') return Response.json({ success: true, uploaded: 1, downloaded: 1, conflicts: 0 });
  if (url.pathname.endsWith('/models')) return Response.json({ data: [{ id: 'openai/gpt-4o-mini' }] });
  if (url.pathname.endsWith('/chat/completions')) return Response.json({
    id: 'sync-ui-fixture', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ toolCalls: [], finalResponse: 'SYNC_UI_TRANSCRIPT_MARKER' }) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 42, completion_tokens: 12, total_tokens: 54 },
  });
  return Response.json({ error: 'Network disabled in missing-download scenario' }, { status: 503 });
};
`);
  return pathToFileURL(preload).href;
}
