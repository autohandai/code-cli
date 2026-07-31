/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
const originalFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = (async (input, init) => {
  const target = typeof input === 'string' || input instanceof URL
    ? String(input)
    : input.url;
  const protocol = new URL(target).protocol;
  if (protocol === 'http:' || protocol === 'https:') {
    const error = new Error(
      `UNEXPECTED_RPC_FETCH: Network access to ${new URL(target).origin} is forbidden `
      + 'in passive restricted-profile tests.',
    );
    process.stderr.write(`${error.stack ?? error.message}\n`);
    throw error;
  }
  return originalFetch(input, init);
}) as typeof fetch;
