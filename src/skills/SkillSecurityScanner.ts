/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * SkillSecurityScanner - Client-side threat pattern scanning for community skills.
 * Provides the second layer of security (after server-side scoring in the registry).
 */

export interface SecurityScanResult {
  /** Safety score 0-100, higher = safer */
  score: number;
  /** Matched threat patterns */
  threats: ThreatMatch[];
  /** Score >= 50 */
  safe: boolean;
  /** Score < 30 */
  blocked: boolean;
}

export interface ThreatMatch {
  /** Threat category */
  category: ThreatCategory;
  /** The regex pattern that matched */
  pattern: string;
  /** 1-indexed line number where the match was found */
  line: number;
  /** The line content containing the match */
  context: string;
}

export type ThreatCategory =
  | 'command-injection'
  | 'data-exfiltration'
  | 'encoded-payload'
  | 'network-calls';

interface ThreatRule {
  category: ThreatCategory;
  pattern: RegExp;
  /** Points deducted per match (higher = more severe) */
  severity: number;
}

const THREAT_RULES: ThreatRule[] = [
  // Command injection
  { category: 'command-injection', pattern: /rm\s+-rf\b/i, severity: 15 },
  { category: 'command-injection', pattern: /curl\s+.*\|\s*bash/i, severity: 20 },
  { category: 'command-injection', pattern: /wget\s+.*\|\s*bash/i, severity: 20 },
  { category: 'command-injection', pattern: /\beval\s*\(/i, severity: 15 },
  { category: 'command-injection', pattern: /\bexec\s*\(/i, severity: 12 },
  { category: 'command-injection', pattern: /\bsudo\b/i, severity: 15 },
  { category: 'command-injection', pattern: /chmod\s+777\b/i, severity: 12 },

  // Data exfiltration
  { category: 'data-exfiltration', pattern: /process\.env\b/i, severity: 10 },
  { category: 'data-exfiltration', pattern: /\bcredentials?\b/i, severity: 8 },
  { category: 'data-exfiltration', pattern: /\bapi[_-]?key\b/i, severity: 8 },
  { category: 'data-exfiltration', pattern: /\bsecret[_-]?key\b/i, severity: 10 },
  { category: 'data-exfiltration', pattern: /\.ssh\/id_rsa\b/i, severity: 15 },

  // Encoded payloads
  { category: 'encoded-payload', pattern: /\batob\s*\(/i, severity: 12 },
  { category: 'encoded-payload', pattern: /Buffer\.from\s*\(/i, severity: 8 },

  // Network calls
  { category: 'network-calls', pattern: /\bfetch\s*\(\s*["'`]https?:\/\//i, severity: 10 },
  { category: 'network-calls', pattern: /\bwget\s+https?:\/\//i, severity: 12 },
  { category: 'network-calls', pattern: /\bcurl\s+https?:\/\//i, severity: 8 },
  { category: 'network-calls', pattern: /http\.request\s*\(/i, severity: 10 },
  { category: 'network-calls', pattern: /XMLHttpRequest/i, severity: 10 },
];

const SAFE_THRESHOLD = 50;
const BLOCKED_THRESHOLD = 30;

export class SkillSecurityScanner {
  /**
   * Scan skill content for security threats.
   * Returns a score (0-100) and list of matched threats.
   */
  scan(content: string): SecurityScanResult {
    if (!content.trim()) {
      return { score: 100, threats: [], safe: true, blocked: false };
    }

    const lines = content.split('\n');
    const threats: ThreatMatch[] = [];
    let deductions = 0;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const lineContent = lines[lineIndex];

      for (const rule of THREAT_RULES) {
        if (rule.pattern.test(lineContent)) {
          threats.push({
            category: rule.category,
            pattern: rule.pattern.source,
            line: lineIndex + 1,
            context: lineContent.trim(),
          });
          deductions += rule.severity;
        }
      }
    }

    const score = Math.max(0, 100 - deductions);

    return {
      score,
      threats,
      safe: score >= SAFE_THRESHOLD,
      blocked: score < BLOCKED_THRESHOLD,
    };
  }
}
