// src/commands/ls.ts
async function listFiles(ctx) {
  await ctx.listWorkspaceFiles();
  return null;
}
var metadata = {
  command: "/ls",
  description: "list files in the current workspace without contacting the LLM",
  implemented: true
};

export {
  listFiles,
  metadata
};
/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
