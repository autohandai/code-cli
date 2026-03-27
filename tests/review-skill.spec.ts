import { describe, it, expect } from 'vitest';
import fse from 'fs-extra';
import path from 'node:path';

describe('bundled code-reviewer skill', () => {
  it('SKILL.md exists with valid frontmatter', async () => {
    const skillPath = path.resolve('src/skills/builtin/code-reviewer/SKILL.md');
    const exists = await fse.pathExists(skillPath);
    expect(exists).toBe(true);

    const content = await fse.readFile(skillPath, 'utf-8');
    expect(content).toMatch(/^---\n/);
    expect(content).toContain('name: code-reviewer');
    expect(content).toContain('description:');
    expect(content).toContain('allowed-tools:');
  });

  it('skill content includes the 10-point review methodology', async () => {
    const skillPath = path.resolve('src/skills/builtin/code-reviewer/SKILL.md');
    const content = await fse.readFile(skillPath, 'utf-8');

    expect(content).toContain('Architecture');
    expect(content).toContain('Security');
    expect(content).toContain('Error Handling');
    expect(content).toContain('Performance');
    expect(content).toContain('Maintainability');
    expect(content).toContain('Type Safety');
    expect(content).toContain('Testing');
    expect(content).toContain('Dependencies');
    expect(content).toContain('API Design');
    expect(content).toContain('DevOps');
  });

  it('skill specifies allowed tools', async () => {
    const skillPath = path.resolve('src/skills/builtin/code-reviewer/SKILL.md');
    const content = await fse.readFile(skillPath, 'utf-8');

    expect(content).toContain('read_file');
    expect(content).toContain('find');
    expect(content).toContain('git_diff');
    expect(content).toContain('code_review');
  });
});
