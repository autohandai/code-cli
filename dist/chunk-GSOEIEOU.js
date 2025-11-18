// src/commands/quit.ts
async function quit() {
  return "/quit";
}
var metadata = {
  command: "/quit",
  description: "end the current Autohand session",
  implemented: true
};

export {
  quit,
  metadata
};
/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
