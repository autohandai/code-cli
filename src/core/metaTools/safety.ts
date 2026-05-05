/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /rm\s+(-[rf]+\s+)*\/(?!\w)/i, description: 'rm with root path' },
  { pattern: /rm\s+.*--no-preserve-root/i, description: 'rm --no-preserve-root' },
  { pattern: /dd\s+.*(?:of|if)=\/dev\/[sh]d/i, description: 'dd to disk device' },
  { pattern: /mkfs\./i, description: 'filesystem format' },
  { pattern: /wipefs/i, description: 'disk wipe' },
  { pattern: /\bsudo\s/i, description: 'sudo command' },
  { pattern: /\bsu\s+-?\s*\w/i, description: 'su command' },
  { pattern: /chmod\s+[0-7]*7[0-7]*/i, description: 'world-writable chmod' },
  { pattern: /chown\s+root/i, description: 'chown to root' },
  { pattern: /curl\s+.*\|\s*(ba)?sh/i, description: 'curl | bash' },
  { pattern: /wget\s+.*\|\s*(ba)?sh/i, description: 'wget | sh' },
  { pattern: /\beval\s+[`$]/i, description: 'eval with expansion' },
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/i, description: 'fork bomb' },
  { pattern: /while\s+true.*do.*done/i, description: 'infinite loop' },
  { pattern: /nc\s+.*-e\s*\/bin/i, description: 'netcat reverse shell' },
  { pattern: /ncat\s+.*-e\s*\/bin/i, description: 'ncat reverse shell' },
  { pattern: /bash\s+-i\s+>&?\s*\/dev\/tcp/i, description: 'bash reverse shell' },
  { pattern: /iptables\s+-F/i, description: 'flush firewall rules' },
  { pattern: /gpg\s+.*--encrypt.*-r\s+\S+\s+\//i, description: 'gpg encrypt root' },
];

export function assertSafeMetaToolHandler(handler: string): void {
  for (const { pattern, description } of DANGEROUS_PATTERNS) {
    if (pattern.test(handler)) {
      throw new Error(`Handler contains dangerous pattern: ${description}`);
    }
  }
}
