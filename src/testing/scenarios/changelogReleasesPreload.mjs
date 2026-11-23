// Answer the GitHub release history request from a recorded response, so the real CLI can show
// /changelog without the network.
import { readFileSync } from 'node:fs';

const releases = readFileSync(new URL('./changelogReleases.fixture.json', import.meta.url), 'utf8');
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return url.startsWith('https://api.github.com/repos/autohandai/code-cli/releases')
    ? Promise.resolve(new Response(releases, { status: 200, headers: { 'content-type': 'application/json' } }))
    : originalFetch(input, init);
};
