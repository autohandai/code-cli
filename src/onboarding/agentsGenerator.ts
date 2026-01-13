/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Information about the project used to generate AGENTS.md
 */
export interface ProjectInfo {
  language?: string;
  framework?: string;
  packageManager?: string;
  testFramework?: string;
  linter?: string;
  formatter?: string;
  buildTool?: string;
}

/**
 * Custom section to add to AGENTS.md
 */
export interface CustomSection {
  title: string;
  content: string;
}

/**
 * Options for generating AGENTS.md
 */
export interface GeneratorOptions {
  customSections?: CustomSection[];
}

/**
 * Generates AGENTS.md content based on project information
 */
export class AgentsGenerator {
  /**
   * Generate AGENTS.md content
   */
  generateContent(info: ProjectInfo, options?: GeneratorOptions): string {
    const sections: string[] = [];

    // Header
    sections.push('# AGENTS.md');
    sections.push('');
    sections.push('This file helps Autohand understand how to work with this project.');
    sections.push('');

    // Project Overview
    sections.push(this.generateProjectOverview(info));

    // Commands
    if (info.packageManager) {
      sections.push(this.generateCommandsSection(info));
    }

    // Testing
    if (info.testFramework) {
      sections.push(this.generateTestingSection(info));
    }

    // Framework-specific instructions
    if (info.framework) {
      const frameworkSection = this.generateFrameworkSection(info);
      if (frameworkSection) {
        sections.push(frameworkSection);
      }
    }

    // Code Style
    sections.push(this.generateCodeStyleSection(info));

    // Constraints
    sections.push(this.generateConstraintsSection());

    // Custom sections
    if (options?.customSections) {
      for (const section of options.customSections) {
        sections.push(`## ${section.title}`);
        sections.push('');
        sections.push(section.content);
        sections.push('');
      }
    }

    return sections.join('\n');
  }

  /**
   * Generate project overview section
   */
  private generateProjectOverview(info: ProjectInfo): string {
    const lines: string[] = [];
    lines.push('## Project Overview');
    lines.push('');

    if (info.language) {
      lines.push(`- **Language**: ${info.language}`);
    }
    if (info.framework) {
      lines.push(`- **Framework**: ${info.framework}`);
    }
    if (info.packageManager) {
      lines.push(`- **Package Manager**: ${info.packageManager}`);
    }
    if (info.testFramework) {
      lines.push(`- **Test Framework**: ${info.testFramework}`);
    }
    if (info.buildTool) {
      lines.push(`- **Build Tool**: ${info.buildTool}`);
    }

    lines.push('');
    return lines.join('\n');
  }

  /**
   * Generate commands section based on package manager
   */
  private generateCommandsSection(info: ProjectInfo): string {
    const lines: string[] = [];
    lines.push('## Commands');
    lines.push('');

    const pm = info.packageManager!;

    // Language-specific commands
    if (info.language === 'Rust') {
      lines.push('- **Build**: `cargo build`');
      lines.push('- **Build (release)**: `cargo build --release`');
      lines.push('- **Run**: `cargo run`');
      lines.push('- **Test**: `cargo test`');
      lines.push('- **Check**: `cargo check`');
      lines.push('- **Format**: `cargo fmt`');
      lines.push('- **Lint**: `cargo clippy`');
    } else if (info.language === 'Go') {
      lines.push('- **Build**: `go build`');
      lines.push('- **Run**: `go run .`');
      lines.push('- **Test**: `go test ./...`');
      lines.push('- **Format**: `go fmt ./...`');
      lines.push('- **Vet**: `go vet ./...`');
    } else if (info.language === 'Python') {
      if (pm === 'poetry') {
        lines.push('- **Install**: `poetry install`');
        lines.push('- **Run**: `poetry run python main.py`');
        lines.push('- **Add dependency**: `poetry add <package>`');
        if (info.testFramework) {
          lines.push(`- **Test**: \`poetry run pytest\``);
        }
      } else if (pm === 'pipenv') {
        lines.push('- **Install**: `pipenv install`');
        lines.push('- **Run**: `pipenv run python main.py`');
        if (info.testFramework) {
          lines.push(`- **Test**: \`pipenv run pytest\``);
        }
      } else {
        lines.push('- **Install**: `pip install -r requirements.txt`');
        lines.push('- **Run**: `python main.py`');
        if (info.testFramework) {
          lines.push(`- **Test**: \`pytest\``);
        }
      }
    } else {
      // Node.js ecosystem
      const run = pm === 'npm' ? 'npm run' : pm;
      const install = pm === 'npm' ? 'npm install' : `${pm} install`;

      lines.push(`- **Install**: \`${install}\``);
      lines.push(`- **Dev**: \`${run} dev\``);
      lines.push(`- **Build**: \`${run} build\``);

      if (info.testFramework) {
        lines.push(`- **Test**: \`${run} test\``);
      }

      if (info.linter) {
        lines.push(`- **Lint**: \`${run} lint\``);
      }

      if (info.formatter) {
        lines.push(`- **Format**: \`${run} format\``);
      }
    }

    lines.push('');
    return lines.join('\n');
  }

  /**
   * Generate testing section
   */
  private generateTestingSection(info: ProjectInfo): string {
    const lines: string[] = [];
    lines.push('## Testing');
    lines.push('');
    lines.push(`This project uses **${info.testFramework}** for testing.`);
    lines.push('');
    lines.push('- Write tests for new features before implementation');
    lines.push('- Run tests before committing changes');
    lines.push('- Aim for good test coverage on critical paths');

    // Framework-specific testing notes
    if (info.testFramework === 'Vitest' || info.testFramework === 'Jest') {
      lines.push('- Use `describe` and `it` blocks to organize tests');
      lines.push('- Mock external dependencies when appropriate');
    } else if (info.testFramework === 'pytest') {
      lines.push('- Use fixtures for shared test setup');
      lines.push('- Use `pytest.mark` for test categorization');
    } else if (info.testFramework === 'Playwright' || info.testFramework === 'Cypress') {
      lines.push('- Write E2E tests for critical user flows');
      lines.push('- Keep selectors stable and meaningful');
    }

    lines.push('');
    return lines.join('\n');
  }

  /**
   * Generate framework-specific section
   */
  private generateFrameworkSection(info: ProjectInfo): string | null {
    const lines: string[] = [];

    switch (info.framework) {
      case 'Next.js':
        lines.push('## Next.js Guidelines');
        lines.push('');
        lines.push('- Use the App Router for new pages (`app/` directory)');
        lines.push('- Prefer Server Components by default');
        lines.push('- Use `"use client"` only when needed for interactivity');
        lines.push('- Keep API routes in `app/api/`');
        lines.push('- Use `next/image` for optimized images');
        lines.push('- Use `next/link` for client-side navigation');
        break;

      case 'React':
        lines.push('## React Guidelines');
        lines.push('');
        lines.push('- Use functional components with hooks');
        lines.push('- Keep components small and focused');
        lines.push('- Use custom hooks to share logic');
        lines.push('- Prefer composition over inheritance');
        lines.push('- Use TypeScript interfaces for props');
        break;

      case 'Vue':
        lines.push('## Vue Guidelines');
        lines.push('');
        lines.push('- Use Composition API for new components');
        lines.push('- Keep components in single-file format (.vue)');
        lines.push('- Use composables to share logic');
        break;

      case 'Express':
        lines.push('## Express Guidelines');
        lines.push('');
        lines.push('- Use middleware for cross-cutting concerns');
        lines.push('- Keep route handlers thin, delegate to services');
        lines.push('- Use async/await with proper error handling');
        lines.push('- Validate request input before processing');
        break;

      case 'FastAPI':
        lines.push('## FastAPI Guidelines');
        lines.push('');
        lines.push('- Use Pydantic models for request/response validation');
        lines.push('- Use dependency injection for shared resources');
        lines.push('- Keep endpoints in organized routers');
        lines.push('- Use async functions for I/O operations');
        break;

      case 'Django':
        lines.push('## Django Guidelines');
        lines.push('');
        lines.push('- Follow Django project structure conventions');
        lines.push('- Use class-based views where appropriate');
        lines.push('- Keep business logic in models or services');
        lines.push('- Use Django ORM for database operations');
        break;

      case 'Flask':
        lines.push('## Flask Guidelines');
        lines.push('');
        lines.push('- Use blueprints to organize routes');
        lines.push('- Keep route handlers focused');
        lines.push('- Use Flask extensions for common functionality');
        break;

      case 'NestJS':
        lines.push('## NestJS Guidelines');
        lines.push('');
        lines.push('- Follow module-based architecture');
        lines.push('- Use dependency injection');
        lines.push('- Use decorators for metadata');
        lines.push('- Keep controllers thin, services fat');
        break;

      default:
        return null;
    }

    lines.push('');
    return lines.join('\n');
  }

  /**
   * Generate code style section
   */
  private generateCodeStyleSection(info: ProjectInfo): string {
    const lines: string[] = [];
    lines.push('## Code Style');
    lines.push('');

    // Language-specific conventions
    if (info.language === 'TypeScript') {
      lines.push('- Use strict TypeScript settings');
      lines.push('- Define types/interfaces for data structures');
      lines.push('- Avoid `any` type - use `unknown` if type is truly unknown');
      lines.push('- Use type inference where obvious');
    } else if (info.language === 'Python') {
      lines.push('- Follow PEP 8 style guidelines');
      lines.push('- Use type hints for function signatures');
      lines.push('- Use docstrings for public functions');
    } else if (info.language === 'Rust') {
      lines.push('- Follow Rust naming conventions (snake_case for functions)');
      lines.push('- Use descriptive error types');
      lines.push('- Prefer `Result` over panicking');
    } else if (info.language === 'Go') {
      lines.push('- Follow Go idioms and conventions');
      lines.push('- Use short variable names in small scopes');
      lines.push('- Handle errors explicitly');
    }

    // General conventions
    lines.push('- Follow existing patterns in the codebase');
    lines.push('- Use meaningful variable and function names');
    lines.push('- Add comments for complex logic');
    lines.push('- Keep functions focused and small');

    // Linter/formatter info
    if (info.linter) {
      lines.push(`- Run **${info.linter}** before committing`);
    }
    if (info.formatter) {
      lines.push(`- Format code with **${info.formatter}**`);
    }

    lines.push('');
    return lines.join('\n');
  }

  /**
   * Generate constraints section
   */
  private generateConstraintsSection(): string {
    const lines: string[] = [];
    lines.push('## Constraints');
    lines.push('');
    lines.push('- Do not modify files outside the project directory');
    lines.push('- Ask before making breaking changes');
    lines.push('- Prefer editing existing files over creating new ones');
    lines.push('- Do not delete files without confirmation');
    lines.push('- Keep dependencies minimal - avoid adding new ones without good reason');
    lines.push('- Do not commit sensitive data (API keys, secrets, credentials)');
    lines.push('');

    return lines.join('\n');
  }
}
