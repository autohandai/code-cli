/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * SkillParser - Parses SKILL.md files with YAML frontmatter
 */
import fs from 'fs-extra';
import YAML from 'yaml';
import type {
  SkillFrontmatter,
  SkillDefinition,
  SkillSource,
  SkillParseResult,
} from './types.js';
import { validateSkillFrontmatter } from './types.js';

/**
 * Frontmatter extraction result
 */
export interface FrontmatterExtraction {
  frontmatter: string;
  body: string;
}

/**
 * Parser for SKILL.md files following the Agent Skills standard
 */
export class SkillParser {
  /**
   * Parse a SKILL.md file from disk
   */
  async parseFile(filePath: string, source: SkillSource): Promise<SkillParseResult> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return this.parseContent(content, filePath, source);
    } catch (error) {
      return {
        success: false,
        error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Parse SKILL.md content directly from a string
   */
  parseContent(content: string, filePath: string, source: SkillSource): SkillParseResult {
    const extraction = this.extractFrontmatter(content);

    if (!extraction) {
      return {
        success: false,
        error: 'No valid YAML frontmatter found. SKILL.md must start with --- delimited frontmatter.',
      };
    }

    try {
      const parsed = YAML.parse(extraction.frontmatter) as Partial<SkillFrontmatter>;

      // Validate the frontmatter
      const validation = validateSkillFrontmatter(parsed);
      if (!validation.valid) {
        return {
          success: false,
          error: `Invalid skill frontmatter: ${validation.errors.join('; ')}`,
        };
      }

      // Build the full skill definition
      const skill: SkillDefinition = {
        name: parsed.name!,
        description: parsed.description!,
        license: parsed.license,
        compatibility: parsed.compatibility,
        metadata: parsed.metadata,
        'allowed-tools': parsed['allowed-tools'],
        body: extraction.body,
        path: filePath,
        source,
        isActive: false,
      };

      return { success: true, skill };
    } catch (error) {
      return {
        success: false,
        error: `Failed to parse YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Extract YAML frontmatter and body from content
   * Frontmatter must be delimited by --- at start and end
   */
  extractFrontmatter(content: string): FrontmatterExtraction | null {
    // Must start with ---
    if (!content.startsWith('---')) {
      return null;
    }

    // Find the closing ---
    const lines = content.split('\n');
    let closingIndex = -1;

    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        closingIndex = i;
        break;
      }
    }

    if (closingIndex === -1) {
      return null;
    }

    // Extract frontmatter (between the --- delimiters)
    const frontmatter = lines.slice(1, closingIndex).join('\n');

    // Extract body (everything after the closing ---)
    const body = lines.slice(closingIndex + 1).join('\n').trim();

    return { frontmatter, body };
  }
}
