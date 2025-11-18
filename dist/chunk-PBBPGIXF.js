// src/commands/help.ts
import chalk from "chalk";
import terminalLink from "terminal-link";
async function help() {
  console.log(chalk.cyan("\n\u{1F4DA} Available Commands:\n"));
  const commands = [
    { cmd: "/ls", desc: "List files in workspace" },
    { cmd: "/diff", desc: "Show git diff" },
    { cmd: "/undo", desc: "Undo last file mutation" },
    { cmd: "/model", desc: "Choose AI model" },
    { cmd: "/approvals", desc: "Configure auto-approvals" },
    { cmd: "/review", desc: "Review current changes" },
    { cmd: "/new", desc: "Start new conversation" },
    { cmd: "/init", desc: "Create AGENTS.md file" },
    { cmd: "/compact", desc: "Compact conversation" },
    { cmd: "/quit", desc: "Exit Autohand" },
    { cmd: "/help", desc: "Show this help" }
  ];
  commands.forEach(({ cmd, desc }) => {
    console.log(`  ${chalk.yellow(cmd.padEnd(12))} ${chalk.gray(desc)}`);
  });
  console.log(chalk.cyan("\n\u{1F4A1} Tips:\n"));
  console.log(chalk.gray("  \u2022 Type @ to mention files for the AI"));
  console.log(chalk.gray("  \u2022 Use arrow keys to navigate file suggestions"));
  console.log(chalk.gray("  \u2022 Press Tab to autocomplete file paths"));
  console.log(chalk.gray("  \u2022 Press Esc to cancel current operation\n"));
  const docLink = terminalLink("docs.autohand.ai", "https://docs.autohand.ai");
  console.log(chalk.gray(`For more information, visit ${docLink}
`));
  return null;
}
var metadata = {
  command: "/help",
  description: "describe available slash commands and tips",
  implemented: true
};

export {
  help,
  metadata
};
/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
