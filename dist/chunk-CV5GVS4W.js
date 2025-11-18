// src/commands/approvals.ts
async function approvals(ctx) {
  await ctx.promptApprovalMode();
  return null;
}
var metadata = {
  command: "/approvals",
  description: "choose what Autohand can do without approval",
  implemented: true
};

export {
  approvals,
  metadata
};
/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
