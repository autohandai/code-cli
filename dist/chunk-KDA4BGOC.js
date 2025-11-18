// src/commands/new.ts
import chalk from "chalk";
async function newConversation(ctx) {
  ctx.resetConversation();
  console.log(chalk.gray("Starting a new conversation."));
  return null;
}
var metadata = {
  command: "/new",
  description: "start a new chat during a conversation",
  implemented: true
};

export {
  newConversation,
  metadata
};
/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
