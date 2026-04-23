/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Mock for yoga-layout to prevent WASM loading issues in test environment
 */

export const loadYoga = async () => {
  return {};
};
