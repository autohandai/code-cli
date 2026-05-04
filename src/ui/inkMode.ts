/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface InkModeEnv {
  AUTOHAND_LEGACY_UI?: string;
  AUTOHAND_NO_INK?: string;
}

/**
 * Ink 7 + React 19 is the default interactive UI.
 *
 * This intentionally ignores the legacy `ui.useInkRenderer` config field so
 * old user config files cannot silently force the plain terminal composer.
 * Keep an environment kill switch for emergency terminal compatibility.
 */
export function shouldUseInkRenderer(env: InkModeEnv = process.env): boolean {
  return env.AUTOHAND_LEGACY_UI !== '1' && env.AUTOHAND_NO_INK !== '1';
}
