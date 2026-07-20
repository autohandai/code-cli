/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const BROWSER_SLASH_COMMAND = '/browser';
export const LEGACY_BROWSER_SLASH_COMMAND = '/chrome';
export const LEGACY_BROWSER_SLASH_COMMAND_WARNING =
  'The /chrome command is retained only for compatibility. Use /browser instead.';
export const LEGACY_BROWSER_CLI_COMMAND_WARNING =
  'The "autohand chrome" command is retained only for compatibility. Use "autohand browser" instead.';

export type DeprecatedBrowserOption = '--chrome' | '--no-chrome';

export function formatDeprecatedBrowserOptionWarning(option: DeprecatedBrowserOption): string {
  const replacement = option === '--chrome' ? '--browser' : '--no-browser';
  return `The ${option} option is retained only for compatibility. Use ${replacement} instead.`;
}
