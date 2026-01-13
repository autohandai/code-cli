/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { AgentsGenerator, type ProjectInfo } from '../../src/onboarding/agentsGenerator';

describe('AgentsGenerator', () => {
  describe('generateContent', () => {
    it('should generate basic AGENTS.md structure', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({});

      expect(content).toContain('# AGENTS.md');
      expect(content).toContain('## Project Overview');
      expect(content).toContain('## Code Style');
      expect(content).toContain('## Constraints');
    });

    it('should include language in project overview', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({
        language: 'TypeScript'
      });

      expect(content).toContain('**Language**: TypeScript');
    });

    it('should include framework in project overview', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({
        framework: 'Next.js'
      });

      expect(content).toContain('**Framework**: Next.js');
    });

    it('should include package manager in project overview', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({
        packageManager: 'bun'
      });

      expect(content).toContain('**Package Manager**: bun');
    });

    it('should include test framework in project overview', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({
        testFramework: 'Vitest'
      });

      expect(content).toContain('**Test Framework**: Vitest');
    });
  });

  describe('Commands Section', () => {
    it('should generate npm commands', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({
        packageManager: 'npm'
      });

      expect(content).toContain('`npm install`');
      expect(content).toContain('`npm run dev`');
      expect(content).toContain('`npm run build`');
    });

    it('should generate bun commands', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({
        packageManager: 'bun'
      });

      expect(content).toContain('`bun install`');
      expect(content).toContain('`bun dev`');
      expect(content).toContain('`bun build`');
    });

    it('should generate pnpm commands', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({
        packageManager: 'pnpm'
      });

      expect(content).toContain('`pnpm install`');
      expect(content).toContain('`pnpm dev`');
      expect(content).toContain('`pnpm build`');
    });

    it('should generate yarn commands', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({
        packageManager: 'yarn'
      });

      expect(content).toContain('`yarn install`');
      expect(content).toContain('`yarn dev`');
      expect(content).toContain('`yarn build`');
    });

    it('should generate cargo commands for Rust', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({
        language: 'Rust',
        packageManager: 'cargo'
      });

      expect(content).toContain('`cargo build`');
      expect(content).toContain('`cargo run`');
      expect(content).toContain('`cargo test`');
    });

    it('should generate go commands for Go', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({
        language: 'Go',
        packageManager: 'go'
      });

      expect(content).toContain('`go build`');
      expect(content).toContain('`go run .`');
      expect(content).toContain('`go test ./...`');
    });

    it('should include test command when test framework is detected', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({
        packageManager: 'npm',
        testFramework: 'Jest'
      });

      expect(content).toContain('`npm run test`');
    });
  });

  describe('Testing Section', () => {
    it('should include testing section when test framework detected', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({
        testFramework: 'Vitest'
      });

      expect(content).toContain('## Testing');
      expect(content).toContain('**Vitest**');
      expect(content).toContain('Write tests for new features');
    });

    it('should not include testing section when no test framework', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({
        packageManager: 'npm'
      });

      expect(content).not.toContain('## Testing');
    });

    it('should include pytest instructions for Python', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({
        language: 'Python',
        testFramework: 'pytest'
      });

      expect(content).toContain('## Testing');
      expect(content).toContain('**pytest**');
    });
  });

  describe('Framework-Specific Instructions', () => {
    it('should include Next.js specific instructions', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({
        framework: 'Next.js'
      });

      expect(content).toContain('Next.js');
      // Should mention app router or pages structure
      expect(content.toLowerCase()).toMatch(/app\s*router|pages|routing/);
    });

    it('should include React specific instructions', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({
        framework: 'React'
      });

      expect(content).toContain('React');
      expect(content.toLowerCase()).toMatch(/component|hook/);
    });

    it('should include Express specific instructions', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({
        framework: 'Express'
      });

      expect(content).toContain('Express');
      expect(content.toLowerCase()).toMatch(/route|middleware/);
    });
  });

  describe('Code Style Section', () => {
    it('should include TypeScript conventions for TypeScript projects', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({
        language: 'TypeScript'
      });

      expect(content).toContain('## Code Style');
      expect(content.toLowerCase()).toMatch(/type|interface|strict/);
    });

    it('should mention linter if detected', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({
        linter: 'ESLint'
      });

      expect(content).toContain('ESLint');
    });

    it('should mention formatter if detected', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({
        formatter: 'Prettier'
      });

      expect(content).toContain('Prettier');
    });
  });

  describe('Constraints Section', () => {
    it('should always include constraints section', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({});

      expect(content).toContain('## Constraints');
      expect(content).toContain('Do not modify files outside the project directory');
      expect(content).toContain('Ask before making breaking changes');
      expect(content).toContain('Prefer editing existing files over creating new ones');
    });
  });

  describe('Full Project Generation', () => {
    it('should generate complete AGENTS.md for TypeScript/Next.js project', () => {
      const generator = new AgentsGenerator();
      const projectInfo: ProjectInfo = {
        language: 'TypeScript',
        framework: 'Next.js',
        packageManager: 'bun',
        testFramework: 'Vitest',
        linter: 'ESLint',
        formatter: 'Prettier'
      };

      const content = generator.generateContent(projectInfo);

      // Check all sections exist
      expect(content).toContain('# AGENTS.md');
      expect(content).toContain('## Project Overview');
      expect(content).toContain('## Commands');
      expect(content).toContain('## Testing');
      expect(content).toContain('## Code Style');
      expect(content).toContain('## Constraints');

      // Check project info
      expect(content).toContain('TypeScript');
      expect(content).toContain('Next.js');
      expect(content).toContain('bun');
      expect(content).toContain('Vitest');
      expect(content).toContain('ESLint');
      expect(content).toContain('Prettier');
    });

    it('should generate complete AGENTS.md for Python/Flask project', () => {
      const generator = new AgentsGenerator();
      const projectInfo: ProjectInfo = {
        language: 'Python',
        framework: 'Flask',
        packageManager: 'poetry',
        testFramework: 'pytest'
      };

      const content = generator.generateContent(projectInfo);

      expect(content).toContain('Python');
      expect(content).toContain('Flask');
      expect(content).toContain('poetry');
      expect(content).toContain('pytest');
    });

    it('should generate complete AGENTS.md for Rust project', () => {
      const generator = new AgentsGenerator();
      const projectInfo: ProjectInfo = {
        language: 'Rust',
        packageManager: 'cargo'
      };

      const content = generator.generateContent(projectInfo);

      expect(content).toContain('Rust');
      expect(content).toContain('cargo');
      expect(content).toContain('`cargo build`');
      expect(content).toContain('`cargo test`');
    });
  });

  describe('Custom Sections', () => {
    it('should allow adding custom sections', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({
        language: 'TypeScript'
      }, {
        customSections: [
          {
            title: 'Deployment',
            content: 'Deploy using Vercel'
          }
        ]
      });

      expect(content).toContain('## Deployment');
      expect(content).toContain('Deploy using Vercel');
    });
  });

  describe('Output Format', () => {
    it('should have proper markdown formatting', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({
        language: 'TypeScript',
        packageManager: 'npm'
      });

      // Check for proper heading levels
      expect(content).toMatch(/^# AGENTS\.md/m);
      expect(content).toMatch(/^## /m);

      // Check for proper list formatting
      expect(content).toMatch(/^- /m);

      // Check for code blocks
      expect(content).toMatch(/`[^`]+`/);
    });

    it('should not have trailing whitespace on lines', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({
        language: 'TypeScript',
        framework: 'Next.js',
        packageManager: 'bun'
      });

      const lines = content.split('\n');
      for (const line of lines) {
        expect(line).toBe(line.trimEnd());
      }
    });

    it('should end with a newline', () => {
      const generator = new AgentsGenerator();
      const content = generator.generateContent({});

      expect(content.endsWith('\n')).toBe(true);
    });
  });
});
