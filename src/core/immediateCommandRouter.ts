/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface RouteOutputOptions {
  persistentInputActiveTurn: boolean;
  terminalRegionsDisabled: boolean;
  writeAbove: (text: string) => void;
}

/**
 * Route immediate-command output to the correct destination.
 *
 * When terminal regions are active (PersistentInput owns the bottom of the
 * screen), output must go through writeAbove() so it appears in the scroll
 * region above the input box. Otherwise, plain console.log() is fine.
 */
export function routeOutput(text: string, opts: RouteOutputOptions): void {
  if (opts.persistentInputActiveTurn && !opts.terminalRegionsDisabled) {
    opts.writeAbove(`${text}\n`);
  } else {
    console.log(text);
  }
}
