// src/commands/model.ts
async function model(ctx) {
  await ctx.promptModelSelection();
  return null;
}
var metadata = {
  command: "/model",
  description: "choose what model and reasoning effort to use",
  implemented: true
};

export {
  model,
  metadata
};
/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
