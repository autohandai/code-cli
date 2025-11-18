/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
export type Formatter = (contents: string, file: string) => Promise<string>;

const builtinFormatters: Record<string, Formatter> = {
  json: async (contents) => {
    const parsed = JSON.parse(contents);
    return JSON.stringify(parsed, null, 2) + '\n';
  },
  trim: async (contents) => contents.trim() + '\n'
};

export async function applyFormatter(name: string, contents: string, file: string): Promise<string> {
  const formatter = builtinFormatters[name];
  if (!formatter) {
    throw new Error(`Formatter ${name} is not available.`);
  }
  return formatter(contents, file);
}
