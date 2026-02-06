/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const FORMULA_PATH = join(ROOT, 'homebrew', 'autohand.rb');

describe('Homebrew formula', () => {
  const pkgJson = JSON.parse(
    readFileSync(join(ROOT, 'package.json'), 'utf-8'),
  );
  const version: string = pkgJson.version;

  it('formula file exists at homebrew/autohand.rb', () => {
    expect(existsSync(FORMULA_PATH)).toBe(true);
  });

  describe('contains required Homebrew class structure', () => {
    let formula: string;

    // Read once for all structure tests
    it('can be read', () => {
      formula = readFileSync(FORMULA_PATH, 'utf-8');
      expect(formula.length).toBeGreaterThan(0);
    });

    it('declares class Autohand < Formula', () => {
      expect(formula).toMatch(/class\s+Autohand\s+<\s+Formula/);
    });

    it('has desc field', () => {
      expect(formula).toContain('desc "Autonomous LLM-powered coding agent CLI"');
    });

    it('has homepage field', () => {
      expect(formula).toContain('homepage "https://autohand.ai"');
    });

    it('has url pointing to npm registry tarball', () => {
      expect(formula).toMatch(/url\s+"https:\/\/registry\.npmjs\.org\/autohand-cli\/-\/autohand-cli-/);
    });

    it('has sha256 placeholder', () => {
      expect(formula).toMatch(/sha256\s+"[A-Fa-f0-9]+"|sha256\s+"PLACEHOLDER"/);
    });

    it('has license field', () => {
      expect(formula).toContain('license "Apache-2.0"');
    });

    it('depends on node', () => {
      expect(formula).toMatch(/depends_on\s+"node"/);
    });

    it('has def install block', () => {
      expect(formula).toMatch(/def\s+install/);
    });

    it('uses std_npm_args in install', () => {
      expect(formula).toContain('std_npm_args');
    });

    it('has test block', () => {
      // Homebrew uses `test do ... end` (DSL block) rather than `def test`
      expect(formula).toMatch(/test\s+do/);
    });

    it('test block checks autohand --version', () => {
      expect(formula).toContain('autohand --version');
    });
  });

  it('version in formula matches package.json version', () => {
    const formula = readFileSync(FORMULA_PATH, 'utf-8');
    expect(formula).toContain(`autohand-cli-${version}.tgz`);
  });
});
