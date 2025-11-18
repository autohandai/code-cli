// src/commands/compact.ts
import chalk from "chalk";
async function compact() {
  console.log(chalk.gray("Conversation is compact by default; no action needed."));
  return null;
}
var metadata = {
  command: "/compact",
  description: "summarize conversation to prevent hitting the context limit",
  implemented: true
};

export {
  compact,
  metadata
};
/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
