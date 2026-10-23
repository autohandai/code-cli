/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';

for (const name of ['TERM', 'COLORTERM'] as const) {
  const override = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  if (override === undefined) continue;
  const value = override.slice(name.length + 3);
  if (value) process.env[name] = value;
  else delete process.env[name];
}

const { showModal } = await import('../../ui/ink/components/Modal.js');
const { AutohandBrand } = await import('../../ui/ink/components/AutohandBrand.js');
const upgradeAvailable = process.argv.includes('--upgrade');

const selected = await showModal({
  header: ({ availableRows }) => <AutohandBrand version="v0.8.2" animate availableRows={availableRows} />,
  title: upgradeAvailable ? 'New version available!' : 'Sign in to continue.',
  options: [
    { label: 'Login', value: 'login' },
    ...(upgradeAvailable ? [{ label: 'Upgrade (v0.8.3 available)', value: 'upgrade' }] : []),
    { label: 'Exit', value: 'exit' },
  ],
  skipAltScreen: true,
});

console.log(`BRANDING_SELECTED:${selected?.value ?? 'cancel'}`);
console.log(`BRANDING_TERMINAL:${process.env.TERM}:${process.env.COLORTERM ?? ''}`);
