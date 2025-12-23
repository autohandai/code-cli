/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SkillParser } from '../../src/skills/SkillParser.js';
import type { SkillSource } from '../../src/skills/types.js';

describe('SkillParser', () => {
  const tempRoot = path.join(os.tmpdir(), `skill-parser-test-${Date.now()}`);
  let parser: SkillParser;

  beforeAll(async () => {
    await fs.ensureDir(tempRoot);
    parser = new SkillParser();
  });

  afterAll(async () => {
    await fs.remove(tempRoot);
  });

  describe('parseFile', () => {
    it('parses a valid SKILL.md with all frontmatter fields', async () => {
      const skillDir = path.join(tempRoot, 'test-skill');
      await fs.ensureDir(skillDir);
      const skillPath = path.join(skillDir, 'SKILL.md');

      const content = `---
name: my-test-skill
description: A test skill for parsing validation
license: MIT
compatibility: Works with Node.js 18+
allowed-tools: read_file write_file run_command
metadata:
  author: test-user
  version: "1.0.0"
---

# My Test Skill

This is the skill body content.

## Usage

Follow these instructions...
`;
      await fs.writeFile(skillPath, content, 'utf-8');

      const result = await parser.parseFile(skillPath, 'autohand-user');

      expect(result.success).toBe(true);
      expect(result.skill).toBeDefined();
      expect(result.skill!.name).toBe('my-test-skill');
      expect(result.skill!.description).toBe('A test skill for parsing validation');
      expect(result.skill!.license).toBe('MIT');
      expect(result.skill!.compatibility).toBe('Works with Node.js 18+');
      expect(result.skill!['allowed-tools']).toBe('read_file write_file run_command');
      expect(result.skill!.metadata).toEqual({ author: 'test-user', version: '1.0.0' });
      expect(result.skill!.body).toContain('# My Test Skill');
      expect(result.skill!.path).toBe(skillPath);
      expect(result.skill!.source).toBe('autohand-user');
      expect(result.skill!.isActive).toBe(false);
    });

    it('parses a minimal valid SKILL.md with only required fields', async () => {
      const skillDir = path.join(tempRoot, 'minimal-skill');
      await fs.ensureDir(skillDir);
      const skillPath = path.join(skillDir, 'SKILL.md');

      const content = `---
name: minimal-skill
description: A minimal skill
---

Just the basics.
`;
      await fs.writeFile(skillPath, content, 'utf-8');

      const result = await parser.parseFile(skillPath, 'claude-user');

      expect(result.success).toBe(true);
      expect(result.skill!.name).toBe('minimal-skill');
      expect(result.skill!.description).toBe('A minimal skill');
      expect(result.skill!.license).toBeUndefined();
      expect(result.skill!.body).toContain('Just the basics.');
    });

    it('returns error for missing name field', async () => {
      const skillDir = path.join(tempRoot, 'no-name-skill');
      await fs.ensureDir(skillDir);
      const skillPath = path.join(skillDir, 'SKILL.md');

      const content = `---
description: A skill without a name
---

Content here.
`;
      await fs.writeFile(skillPath, content, 'utf-8');

      const result = await parser.parseFile(skillPath, 'autohand-user');

      expect(result.success).toBe(false);
      expect(result.error).toContain('name');
    });

    it('returns error for missing description field', async () => {
      const skillDir = path.join(tempRoot, 'no-desc-skill');
      await fs.ensureDir(skillDir);
      const skillPath = path.join(skillDir, 'SKILL.md');

      const content = `---
name: no-description
---

Content here.
`;
      await fs.writeFile(skillPath, content, 'utf-8');

      const result = await parser.parseFile(skillPath, 'autohand-user');

      expect(result.success).toBe(false);
      expect(result.error).toContain('description');
    });

    it('returns error for invalid name format (uppercase)', async () => {
      const skillDir = path.join(tempRoot, 'uppercase-skill');
      await fs.ensureDir(skillDir);
      const skillPath = path.join(skillDir, 'SKILL.md');

      const content = `---
name: MyInvalidName
description: This has an invalid name
---

Content.
`;
      await fs.writeFile(skillPath, content, 'utf-8');

      const result = await parser.parseFile(skillPath, 'autohand-user');

      expect(result.success).toBe(false);
      expect(result.error).toContain('name');
    });

    it('returns error for name exceeding max length', async () => {
      const skillDir = path.join(tempRoot, 'long-name-skill');
      await fs.ensureDir(skillDir);
      const skillPath = path.join(skillDir, 'SKILL.md');

      const longName = 'a'.repeat(65); // Max is 64
      const content = `---
name: ${longName}
description: This has a name that is too long
---

Content.
`;
      await fs.writeFile(skillPath, content, 'utf-8');

      const result = await parser.parseFile(skillPath, 'autohand-user');

      expect(result.success).toBe(false);
      expect(result.error).toContain('name');
    });

    it('returns error for description exceeding max length', async () => {
      const skillDir = path.join(tempRoot, 'long-desc-skill');
      await fs.ensureDir(skillDir);
      const skillPath = path.join(skillDir, 'SKILL.md');

      const longDesc = 'a'.repeat(1025); // Max is 1024
      const content = `---
name: long-desc
description: ${longDesc}
---

Content.
`;
      await fs.writeFile(skillPath, content, 'utf-8');

      const result = await parser.parseFile(skillPath, 'autohand-user');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Description');
    });

    it('returns error for non-existent file', async () => {
      const result = await parser.parseFile('/nonexistent/path/SKILL.md', 'autohand-user');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('returns error for file without frontmatter', async () => {
      const skillDir = path.join(tempRoot, 'no-frontmatter-skill');
      await fs.ensureDir(skillDir);
      const skillPath = path.join(skillDir, 'SKILL.md');

      const content = `# Just a regular markdown file

No YAML frontmatter here.
`;
      await fs.writeFile(skillPath, content, 'utf-8');

      const result = await parser.parseFile(skillPath, 'autohand-user');

      expect(result.success).toBe(false);
      expect(result.error).toContain('frontmatter');
    });

    it('handles empty body after frontmatter', async () => {
      const skillDir = path.join(tempRoot, 'empty-body-skill');
      await fs.ensureDir(skillDir);
      const skillPath = path.join(skillDir, 'SKILL.md');

      const content = `---
name: empty-body
description: A skill with no body content
---
`;
      await fs.writeFile(skillPath, content, 'utf-8');

      const result = await parser.parseFile(skillPath, 'autohand-user');

      expect(result.success).toBe(true);
      expect(result.skill!.body).toBe('');
    });
  });

  describe('parseContent', () => {
    it('parses content string directly', () => {
      const content = `---
name: inline-skill
description: Parsed from string
---

Body content here.
`;
      const result = parser.parseContent(content, '/fake/path/SKILL.md', 'codex-user');

      expect(result.success).toBe(true);
      expect(result.skill!.name).toBe('inline-skill');
      expect(result.skill!.source).toBe('codex-user');
    });
  });

  describe('extractFrontmatter', () => {
    it('correctly separates frontmatter from body', () => {
      const content = `---
name: test
description: test desc
---

# Body starts here

More content.
`;
      const extracted = parser.extractFrontmatter(content);

      expect(extracted).not.toBeNull();
      expect(extracted!.frontmatter).toContain('name: test');
      expect(extracted!.body.trim()).toBe('# Body starts here\n\nMore content.');
    });

    it('returns null for content without frontmatter', () => {
      const content = `# No frontmatter

Just regular markdown.
`;
      const extracted = parser.extractFrontmatter(content);

      expect(extracted).toBeNull();
    });

    it('handles frontmatter with no body', () => {
      const content = `---
name: no-body
description: no body after
---`;
      const extracted = parser.extractFrontmatter(content);

      expect(extracted).not.toBeNull();
      expect(extracted!.frontmatter).toContain('name: no-body');
      expect(extracted!.body).toBe('');
    });
  });
});
