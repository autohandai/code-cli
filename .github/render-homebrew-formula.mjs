#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/i;

function requireVersion(version) {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid stable release version: ${version}`);
  }
}

function requireChecksum(name, checksum) {
  if (!CHECKSUM_PATTERN.test(checksum)) {
    throw new Error(`Invalid SHA-256 checksum for ${name}`);
  }
}

export function renderHomebrewFormula({ version, checksums }) {
  requireVersion(version);

  for (const [name, checksum] of [
    ['macosArm64', checksums.macosArm64],
    ['macosX64', checksums.macosX64],
    ['linuxArm64', checksums.linuxArm64],
    ['linuxX64', checksums.linuxX64],
  ]) {
    requireChecksum(name, checksum);
  }

  const releaseBaseUrl = `https://github.com/autohandai/code-cli/releases/download/v${version}`;

  return `class AutohandCode < Formula
  desc "Autonomous LLM-powered coding agent CLI"
  homepage "https://autohand.ai"
  version "${version}"
  license "Apache-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "${releaseBaseUrl}/autohand-macos-arm64.tar.gz"
      sha256 "${checksums.macosArm64}"
    else
      url "${releaseBaseUrl}/autohand-macos-x64.tar.gz"
      sha256 "${checksums.macosX64}"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "${releaseBaseUrl}/autohand-linux-arm64.tar.gz"
      sha256 "${checksums.linuxArm64}"
    else
      url "${releaseBaseUrl}/autohand-linux-x64.tar.gz"
      sha256 "${checksums.linuxX64}"
    end
  end

  def install
    bin.install "autohand"
    bin.install_symlink "autohand" => "autohand-code"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/autohand --version")
  end
end
`;
}

function runCli() {
  const { values } = parseArgs({
    options: {
      version: { type: 'string' },
      'macos-arm64-sha': { type: 'string' },
      'macos-x64-sha': { type: 'string' },
      'linux-arm64-sha': { type: 'string' },
      'linux-x64-sha': { type: 'string' },
      output: { type: 'string' },
    },
    strict: true,
  });

  const requiredValues = [
    values.version,
    values['macos-arm64-sha'],
    values['macos-x64-sha'],
    values['linux-arm64-sha'],
    values['linux-x64-sha'],
    values.output,
  ];

  if (requiredValues.some(value => !value)) {
    throw new Error('Version, all platform checksums, and output are required');
  }

  const formula = renderHomebrewFormula({
    version: values.version,
    checksums: {
      macosArm64: values['macos-arm64-sha'],
      macosX64: values['macos-x64-sha'],
      linuxArm64: values['linux-arm64-sha'],
      linuxX64: values['linux-x64-sha'],
    },
  });

  writeFileSync(values.output, formula, 'utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
