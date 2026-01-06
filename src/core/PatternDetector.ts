/**
 * Pattern Detector
 *
 * Automatically detects project patterns like tech stack, test/build/lint commands,
 * and frameworks from project configuration files.
 *
 * @license Apache-2.0
 */
import path from 'path';
import fs from 'fs-extra';

export interface ProjectPatterns {
  techStack: string[];
  testCommand?: string;
  buildCommand?: string;
  lintCommand?: string;
  framework?: string;
  packageManager?: string;
}

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * PatternDetector analyzes project files to discover tech stack and commands
 */
export class PatternDetector {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Detect all project patterns
   */
  async detect(): Promise<ProjectPatterns> {
    const [techStack, commands, framework, packageManager] = await Promise.all([
      this.detectTechStack(),
      this.detectCommands(),
      this.detectFramework(),
      this.detectPackageManager(),
    ]);

    return {
      techStack,
      testCommand: commands.test,
      buildCommand: commands.build,
      lintCommand: commands.lint,
      framework,
      packageManager,
    };
  }

  /**
   * Detect tech stack from project files
   */
  private async detectTechStack(): Promise<string[]> {
    const stack: string[] = [];

    // Check for Node.js/JavaScript project
    const packageJsonPath = path.join(this.workspaceRoot, 'package.json');
    if (await fs.pathExists(packageJsonPath)) {
      try {
        const pkg: PackageJson = await fs.readJSON(packageJsonPath);
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
        };

        // TypeScript
        if (allDeps.typescript || await fs.pathExists(path.join(this.workspaceRoot, 'tsconfig.json'))) {
          stack.push('TypeScript');
        } else {
          stack.push('JavaScript');
        }

        // React
        if (allDeps.react) {
          stack.push('React');
        }

        // Vue
        if (allDeps.vue) {
          stack.push('Vue');
        }

        // Svelte
        if (allDeps.svelte) {
          stack.push('Svelte');
        }

        // Node.js
        stack.push('Node.js');

        // Testing frameworks
        if (allDeps.vitest) {
          stack.push('Vitest');
        } else if (allDeps.jest) {
          stack.push('Jest');
        } else if (allDeps.mocha) {
          stack.push('Mocha');
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Check for Rust project
    if (await fs.pathExists(path.join(this.workspaceRoot, 'Cargo.toml'))) {
      stack.push('Rust');
    }

    // Check for Go project
    if (await fs.pathExists(path.join(this.workspaceRoot, 'go.mod'))) {
      stack.push('Go');
    }

    // Check for Python project
    if (
      await fs.pathExists(path.join(this.workspaceRoot, 'pyproject.toml')) ||
      await fs.pathExists(path.join(this.workspaceRoot, 'setup.py')) ||
      await fs.pathExists(path.join(this.workspaceRoot, 'requirements.txt'))
    ) {
      stack.push('Python');
    }

    // Check for Java project
    if (
      await fs.pathExists(path.join(this.workspaceRoot, 'pom.xml')) ||
      await fs.pathExists(path.join(this.workspaceRoot, 'build.gradle'))
    ) {
      stack.push('Java');
    }

    return stack;
  }

  /**
   * Detect test, build, and lint commands from package.json scripts
   */
  private async detectCommands(): Promise<{
    test?: string;
    build?: string;
    lint?: string;
  }> {
    const commands: { test?: string; build?: string; lint?: string } = {};

    const packageJsonPath = path.join(this.workspaceRoot, 'package.json');
    if (await fs.pathExists(packageJsonPath)) {
      try {
        const pkg: PackageJson = await fs.readJSON(packageJsonPath);
        const scripts = pkg.scripts ?? {};

        // Detect package manager
        const pm = await this.detectPackageManager();
        const runCmd = pm === 'bun' ? 'bun' : pm === 'yarn' ? 'yarn' : pm === 'pnpm' ? 'pnpm' : 'npm run';

        // Test command
        if (scripts.test) {
          commands.test = `${runCmd} test`;
        }

        // Build command
        if (scripts.build) {
          commands.build = `${runCmd} build`;
        }

        // Lint command
        if (scripts.lint) {
          commands.lint = `${runCmd} lint`;
        } else if (scripts.eslint) {
          commands.lint = `${runCmd} eslint`;
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Check for Makefile
    if (await fs.pathExists(path.join(this.workspaceRoot, 'Makefile'))) {
      try {
        const makefile = await fs.readFile(path.join(this.workspaceRoot, 'Makefile'), 'utf-8');
        if (!commands.test && makefile.includes('test:')) {
          commands.test = 'make test';
        }
        if (!commands.build && makefile.includes('build:')) {
          commands.build = 'make build';
        }
        if (!commands.lint && makefile.includes('lint:')) {
          commands.lint = 'make lint';
        }
      } catch {
        // Ignore read errors
      }
    }

    // Check for Cargo (Rust)
    if (await fs.pathExists(path.join(this.workspaceRoot, 'Cargo.toml'))) {
      if (!commands.test) commands.test = 'cargo test';
      if (!commands.build) commands.build = 'cargo build';
      if (!commands.lint) commands.lint = 'cargo clippy';
    }

    // Check for Go
    if (await fs.pathExists(path.join(this.workspaceRoot, 'go.mod'))) {
      if (!commands.test) commands.test = 'go test ./...';
      if (!commands.build) commands.build = 'go build';
      if (!commands.lint) commands.lint = 'golangci-lint run';
    }

    return commands;
  }

  /**
   * Detect the main framework used
   */
  private async detectFramework(): Promise<string | undefined> {
    const packageJsonPath = path.join(this.workspaceRoot, 'package.json');
    if (await fs.pathExists(packageJsonPath)) {
      try {
        const pkg: PackageJson = await fs.readJSON(packageJsonPath);
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
        };

        // Next.js
        if (allDeps.next) {
          const version = allDeps.next.replace(/[^0-9.]/g, '').split('.')[0];
          return `Next.js ${version}`;
        }

        // Remix
        if (allDeps['@remix-run/node'] || allDeps['@remix-run/react']) {
          return 'Remix';
        }

        // Astro
        if (allDeps.astro) {
          return 'Astro';
        }

        // Express
        if (allDeps.express) {
          return 'Express';
        }

        // Fastify
        if (allDeps.fastify) {
          return 'Fastify';
        }

        // NestJS
        if (allDeps['@nestjs/core']) {
          return 'NestJS';
        }

        // Hono
        if (allDeps.hono) {
          return 'Hono';
        }

        // Elysia
        if (allDeps.elysia) {
          return 'Elysia';
        }
      } catch {
        // Ignore parse errors
      }
    }

    return undefined;
  }

  /**
   * Detect the package manager used
   */
  private async detectPackageManager(): Promise<string> {
    // Check for lockfiles in order of preference
    if (await fs.pathExists(path.join(this.workspaceRoot, 'bun.lockb'))) {
      return 'bun';
    }
    if (await fs.pathExists(path.join(this.workspaceRoot, 'pnpm-lock.yaml'))) {
      return 'pnpm';
    }
    if (await fs.pathExists(path.join(this.workspaceRoot, 'yarn.lock'))) {
      return 'yarn';
    }
    if (await fs.pathExists(path.join(this.workspaceRoot, 'package-lock.json'))) {
      return 'npm';
    }

    // Default to npm
    return 'npm';
  }
}
