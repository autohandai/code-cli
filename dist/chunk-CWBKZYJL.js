// src/commands/undo.ts
async function undo(ctx) {
  await ctx.undoLastMutation();
  return null;
}
var metadata = {
  command: "/undo",
  description: "ask Autohand to undo a turn",
  implemented: true
};

export {
  undo,
  metadata
};
/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
