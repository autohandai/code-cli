// src/commands/review.ts
async function review() {
  return "Review my current changes and find issues. Focus on bugs and risky diffs.";
}
var metadata = {
  command: "/review",
  description: "review my current changes and find issues",
  implemented: true
};

export {
  review,
  metadata
};
/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
