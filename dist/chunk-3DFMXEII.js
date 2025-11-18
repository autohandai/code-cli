// src/commands/diff.ts
async function diff(ctx) {
  ctx.printGitDiff();
  return null;
}
var metadata = {
  command: "/diff",
  description: "show git diff (including untracked files)",
  implemented: true
};

export {
  diff,
  metadata
};
/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
