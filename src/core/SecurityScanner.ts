/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Secret severity levels
 */
export type SecretSeverity = 'high' | 'medium' | 'low';

/**
 * Pattern for detecting secrets
 */
export interface SecretPattern {
  name: string;
  regex: RegExp;
  severity: SecretSeverity;
  description?: string;
}

/**
 * Security finding from scan
 */
export interface SecurityFinding {
  type: string;
  severity: SecretSeverity;
  line: string;
  lineNumber?: number;
  file?: string;
  match: string;
}

/**
 * Security scan result
 */
export interface SecurityScanResult {
  clean: boolean;
  findings: SecurityFinding[];
  blockedCount: number;
  warningCount: number;
}

/**
 * Scans diffs and files for secrets, API keys, and sensitive data.
 * Blocks commits containing high-severity secrets.
 */
export class SecurityScanner {
  /**
   * Built-in secret detection patterns
   */
  private patterns: SecretPattern[] = [
    // AWS
    {
      name: 'AWS Access Key',
      regex: /AKIA[0-9A-Z]{16}/,
      severity: 'high',
      description: 'AWS Access Key ID',
    },

    // GitHub
    {
      name: 'GitHub Token',
      regex: /ghp_[a-zA-Z0-9]{36}/,
      severity: 'high',
      description: 'GitHub Personal Access Token',
    },
    {
      name: 'GitHub OAuth',
      regex: /gho_[a-zA-Z0-9]{36}/,
      severity: 'high',
      description: 'GitHub OAuth Token',
    },
    {
      name: 'GitHub App Token',
      regex: /ghu_[a-zA-Z0-9]{36}/,
      severity: 'high',
      description: 'GitHub App User Token',
    },

    // OpenAI / Anthropic
    {
      name: 'OpenAI Key',
      regex: /sk-proj-[a-zA-Z0-9]{32,}/,
      severity: 'high',
      description: 'OpenAI Project API Key',
    },
    {
      name: 'Anthropic Key',
      regex: /sk-ant-api[a-zA-Z0-9-]{32,}/,
      severity: 'high',
      description: 'Anthropic API Key',
    },

    // Google
    {
      name: 'Google API Key',
      regex: /AIzaSy[0-9A-Za-z-_]{33}/,
      severity: 'high',
      description: 'Google API Key',
    },

    // Stripe
    {
      name: 'Stripe Live Key',
      regex: /sk_live_[0-9a-zA-Z]{24,}/,
      severity: 'high',
      description: 'Stripe Live Secret Key',
    },
    {
      name: 'Stripe Test Key',
      regex: /sk_test_[0-9a-zA-Z]{24,}/,
      severity: 'low',
      description: 'Stripe Test Secret Key',
    },

    // Private Keys
    {
      name: 'Private Key',
      regex: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
      severity: 'high',
      description: 'Private Key File',
    },

    // Database URLs with credentials
    {
      name: 'Database URL',
      regex: /(postgres|postgresql|mysql|mongodb|redis):\/\/[^:]+:[^@]+@/,
      severity: 'high',
      description: 'Database URL with credentials',
    },

    // JWT Tokens
    {
      name: 'JWT Token',
      regex: /eyJ[a-zA-Z0-9]{10,}\.eyJ[a-zA-Z0-9]{10,}\.[a-zA-Z0-9_-]{10,}/,
      severity: 'medium',
      description: 'JSON Web Token',
    },

    // Generic patterns (lower priority)
    {
      name: 'Generic API Key',
      regex: /[aA][pP][iI][-_]?[kK][eE][yY]\s*[:=]\s*['"][a-zA-Z0-9]{16,}['"]/,
      severity: 'medium',
      description: 'Generic API Key Assignment',
    },
    {
      name: 'Generic Secret',
      regex: /[sS][eE][cC][rR][eE][tT]\s*[:=]\s*['"][^'"]{8,}['"]/,
      severity: 'medium',
      description: 'Generic Secret Assignment',
    },
    {
      name: 'Password Assignment',
      regex: /[pP][aA][sS][sS][wW][oO][rR][dD]\s*[:=]\s*['"][^'"]{4,}['"]/,
      severity: 'medium',
      description: 'Password Assignment',
    },
  ];

  /**
   * Placeholder patterns to ignore (false positives)
   * These must be exact matches or specific patterns, not substrings
   */
  private readonly placeholderPatterns = [
    /your[-_]?api[-_]?key/i,
    /your[-_]?secret/i,
    /\*\*\*/,
    /\.\.\.$/,
    /-example/i,
    /placeholder/i,
    /sk-xxx$/i,
    /sk-your/i,
    /<your[-_]?key[-_]?here>/i,
    /\$\{[A-Z_]+\}/, // Environment variable placeholders
    /process\.env\./,
  ];

  /**
   * Scan git diff for secrets
   * @param diff - Git diff output
   * @returns Security scan result
   */
  scanDiff(diff: string): SecurityScanResult {
    const findings: SecurityFinding[] = [];
    const lines = diff.split('\n');

    let currentFile: string | undefined;
    let lineNumber = 0;

    for (const line of lines) {
      // Track file changes from diff header
      if (line.startsWith('+++ b/')) {
        currentFile = line.slice(6);
        continue;
      }

      // Also check for diff --git format
      if (line.startsWith('diff --git')) {
        const match = line.match(/diff --git a\/.+ b\/(.+)/);
        if (match) {
          currentFile = match[1];
        }
        continue;
      }

      // Track line numbers from hunk headers
      if (line.startsWith('@@')) {
        const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
        if (match) {
          lineNumber = parseInt(match[1], 10) - 1;
        }
        continue;
      }

      // Skip removed lines and context lines for line counting
      if (line.startsWith('-') && !line.startsWith('---')) {
        continue;
      }

      if (line.startsWith(' ')) {
        lineNumber++;
        continue;
      }

      // Only scan added lines (starting with +)
      if (!line.startsWith('+') || line.startsWith('+++')) {
        continue;
      }

      lineNumber++;
      const content = line.slice(1); // Remove + prefix

      // Skip likely false positives
      if (this.isLikelyFalsePositive(content)) {
        continue;
      }

      // Check against patterns
      this.scanLine(content, currentFile, lineNumber, findings);
    }

    return this.buildResult(findings);
  }

  /**
   * Scan file content directly
   * @param content - File content
   * @param filename - Optional filename for reporting
   * @returns Security scan result
   */
  scanFile(content: string, filename?: string): SecurityScanResult {
    const findings: SecurityFinding[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (this.isLikelyFalsePositive(line)) {
        continue;
      }

      this.scanLine(line, filename, i + 1, findings);
    }

    return this.buildResult(findings);
  }

  /**
   * Scan a single line for secrets
   */
  private scanLine(
    line: string,
    file: string | undefined,
    lineNumber: number,
    findings: SecurityFinding[]
  ): void {
    for (const pattern of this.patterns) {
      const match = line.match(pattern.regex);
      if (match) {
        findings.push({
          type: pattern.name,
          severity: pattern.severity,
          line,
          lineNumber,
          file,
          match: match[0],
        });
      }
    }
  }

  /**
   * Build scan result from findings
   */
  private buildResult(findings: SecurityFinding[]): SecurityScanResult {
    const blockedCount = findings.filter((f) => f.severity === 'high').length;
    const warningCount = findings.filter((f) => f.severity !== 'high').length;

    return {
      clean: blockedCount === 0,
      findings,
      blockedCount,
      warningCount,
    };
  }

  /**
   * Check if commit should be blocked based on scan result
   * @param result - Security scan result
   * @returns true if commit should be blocked
   */
  shouldBlockCommit(result: SecurityScanResult): boolean {
    return result.blockedCount > 0;
  }

  /**
   * Check if a line is likely a false positive
   */
  private isLikelyFalsePositive(line: string): boolean {
    // Skip comments
    if (/^\s*(\/\/|#|\/\*|\*|<!--)/.test(line)) {
      return true;
    }

    // Skip lines matching placeholder patterns
    for (const pattern of this.placeholderPatterns) {
      if (pattern.test(line)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Add a custom secret pattern
   * @param pattern - Pattern to add
   */
  addPattern(pattern: SecretPattern): void {
    this.patterns.push(pattern);
  }

  /**
   * Get all configured patterns (returns a copy)
   * @returns Array of secret patterns
   */
  getPatterns(): SecretPattern[] {
    return [...this.patterns];
  }

  /**
   * Format scan result for display
   * @param result - Security scan result
   * @returns Formatted string for terminal display
   */
  formatDisplay(result: SecurityScanResult): string {
    const lines: string[] = ['[SECURITY] Scanning staged changes...'];

    if (result.findings.length === 0) {
      lines.push('');
      lines.push('[OK] No secrets detected');
      return lines.join('\n');
    }

    lines.push('');

    for (const finding of result.findings) {
      const severity =
        finding.severity === 'high' ? '[HIGH]' : finding.severity === 'medium' ? '[WARN]' : '[LOW]';

      lines.push(`  ${severity} ${finding.type} detected`);

      if (finding.file && finding.lineNumber) {
        lines.push(`         File: ${finding.file}:${finding.lineNumber}`);
      } else if (finding.file) {
        lines.push(`         File: ${finding.file}`);
      }

      // Redact the actual secret in display
      const redactedLine = this.redactSecret(finding.line, finding.match);
      lines.push(`         Line: ${redactedLine}`);
      lines.push('');
    }

    if (result.blockedCount > 0) {
      lines.push(`[BLOCKED] ${result.blockedCount} high-severity secrets found`);
      lines.push('          Remove secrets before committing.');
      lines.push('          Consider using environment variables instead.');
    } else if (result.warningCount > 0) {
      lines.push(`[WARN] ${result.warningCount} potential secrets found`);
      lines.push('       Review before committing.');
    }

    return lines.join('\n');
  }

  /**
   * Redact a secret in a line for display
   */
  private redactSecret(line: string, secret: string): string {
    if (secret.length <= 8) {
      return line.replace(secret, '*'.repeat(secret.length));
    }

    // Keep first 4 and last 4 characters visible
    const redacted = secret.slice(0, 4) + '*'.repeat(secret.length - 8) + secret.slice(-4);
    return line.replace(secret, redacted);
  }
}
