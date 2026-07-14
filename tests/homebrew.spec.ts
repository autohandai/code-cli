/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { renderHomebrewFormula } from '../.github/render-homebrew-formula.mjs';

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

  describe('release tap formula', () => {
    const formula = renderHomebrewFormula({
      version: '1.2.3',
      checksums: {
        macosArm64: 'a'.repeat(64),
        macosX64: 'b'.repeat(64),
        linuxArm64: 'c'.repeat(64),
        linuxX64: 'd'.repeat(64),
      },
    });

    it('uses immutable release archives and their platform checksums', () => {
      expect(formula).toContain('version "1.2.3"');
      expect(formula).toContain('/releases/download/v1.2.3/autohand-macos-arm64.tar.gz');
      expect(formula).toContain('/releases/download/v1.2.3/autohand-macos-x64.tar.gz');
      expect(formula).toContain('/releases/download/v1.2.3/autohand-linux-arm64.tar.gz');
      expect(formula).toContain('/releases/download/v1.2.3/autohand-linux-x64.tar.gz');
      expect(formula).toContain(`sha256 "${'a'.repeat(64)}"`);
      expect(formula).toContain(`sha256 "${'d'.repeat(64)}"`);
    });

    it('installs the canonical command and keeps the previous command as an alias', () => {
      expect(formula).toContain('bin.install "autohand"');
      expect(formula).toContain('bin.install_symlink "autohand" => "autohand-code"');
      expect(formula).toContain('shell_output("#{bin}/autohand --version")');
    });

    it('rejects release values that could produce executable Ruby', () => {
      expect(() => renderHomebrewFormula({
        version: '1.2.3\"; system \"env',
        checksums: {
          macosArm64: 'a'.repeat(64),
          macosX64: 'b'.repeat(64),
          linuxArm64: 'c'.repeat(64),
          linuxX64: 'd'.repeat(64),
        },
      })).toThrow(/version/i);

      expect(() => renderHomebrewFormula({
        version: '1.2.3',
        checksums: {
          macosArm64: 'not-a-checksum',
          macosX64: 'b'.repeat(64),
          linuxArm64: 'c'.repeat(64),
          linuxX64: 'd'.repeat(64),
        },
      })).toThrow(/checksum/i);
    });
  });

  it('publishes the tap from verified local release archives', () => {
    const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf-8');

    expect(workflow).toContain('node .github/render-homebrew-formula.mjs');
    expect(workflow).toContain('release-binaries/autohand-macos-arm64.tar.gz');
    expect(workflow).toContain('release-binaries/autohand-linux-x64.tar.gz');
    expect(workflow).not.toMatch(/curl -sL .*\| shasum/);
  });

  it('documents the Homebrew 6 compatible direct installation command', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf-8');
    const authSource = readFileSync(join(ROOT, 'src', 'auth', 'ensureAuth.ts'), 'utf-8');
    const installCommand = 'brew install autohandai/code/autohand-code';

    expect(readme).toContain(installCommand);
    expect(authSource).toContain(installCommand);
    expect(authSource).not.toContain('brew tap autohandai/code && brew install autohand-code');
  });
});
