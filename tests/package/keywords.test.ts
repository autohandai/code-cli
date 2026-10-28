/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { keywords?: string[] };

describe('npm discoverability', () => {
  it('lists the keywords people search for', () => {
    for (const keyword of ['coding-agent', 'ai-coding-agent', 'claude-code', 'codex', 'mcp', 'ollama', 'byok', 'terminal']) {
      expect(pkg.keywords).toContain(keyword);
    }
  });

  it('keeps the existing keywords', () => {
    for (const keyword of ['cli', 'llm', 'agent', 'agentic', 'autohand']) {
      expect(pkg.keywords).toContain(keyword);
    }
  });
});
