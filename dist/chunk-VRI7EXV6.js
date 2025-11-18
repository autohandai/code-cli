// src/commands/init.ts
async function init(ctx) {
  await ctx.createAgentsFile();
  return null;
}
var metadata = {
  command: "/init",
  description: "create an AGENTS.md file with instructions for Autohand",
  implemented: true
};

export {
  init,
  metadata
};
/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
