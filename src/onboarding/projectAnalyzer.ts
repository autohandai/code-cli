/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { pathExists, readJson, readFile } from 'fs-extra';
import { join } from 'path';

/**
 * Information about the project detected by the analyzer
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
 * Analyzes a workspace to detect project characteristics
 */
export class ProjectAnalyzer {
  constructor(private workspaceRoot: string) {}

  /**
   * Analyze the workspace and return project information
   */
  async analyze(): Promise<ProjectInfo> {
    const info: ProjectInfo = {};

    // Try to detect from package.json first (Node.js ecosystem)
    await this.analyzeNodeProject(info);

    // Check for Rust project
    await this.analyzeRustProject(info);

    // Check for Go project
    await this.analyzeGoProject(info);

    // Check for Python project
    await this.analyzePythonProject(info);

    return info;
  }

  /**
   * Analyze Node.js/JavaScript/TypeScript project
   */
  private async analyzeNodeProject(info: ProjectInfo): Promise<void> {
    const pkgPath = join(this.workspaceRoot, 'package.json');

    if (!await pathExists(pkgPath)) {
      return;
    }

    try {
      const pkg = await readJson(pkgPath);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Detect language
      if (deps.typescript || pkg.devDependencies?.typescript) {
        info.language = 'TypeScript';
      } else {
        info.language = 'JavaScript';
      }

      // Detect framework (order matters - more specific first)
      info.framework = this.detectNodeFramework(deps);

      // Detect package manager
      info.packageManager = await this.detectNodePackageManager();

      // Detect test framework
      info.testFramework = this.detectNodeTestFramework(deps);

      // Detect linter
      info.linter = this.detectNodeLinter(deps);

      // Detect formatter
      info.formatter = this.detectNodeFormatter(deps);

      // Detect build tool
      info.buildTool = this.detectNodeBuildTool(deps);
    } catch {
      // Ignore JSON parse errors
    }
  }

  /**
   * Detect Node.js framework from dependencies
   */
  private detectNodeFramework(deps: Record<string, string>): string | undefined {
    // Full-stack frameworks (check first)
    if (deps.next) return 'Next.js';
    if (deps.nuxt) return 'Nuxt';
    if (deps['@remix-run/node'] || deps['@remix-run/react']) return 'Remix';

    // Frontend frameworks
    if (deps['@angular/core']) return 'Angular';
    if (deps.svelte) return 'Svelte';
    if (deps.vue) return 'Vue';
    if (deps.react) return 'React';
    if (deps.solid) return 'Solid';

    // Backend frameworks
    if (deps['@nestjs/core']) return 'NestJS';
    if (deps.fastify) return 'Fastify';
    if (deps.hono) return 'Hono';
    if (deps.koa) return 'Koa';
    if (deps.express) return 'Express';

    return undefined;
  }

  /**
   * Detect Node.js package manager from lockfiles
   */
  private async detectNodePackageManager(): Promise<string> {
    // Check lockfiles in priority order
    if (await pathExists(join(this.workspaceRoot, 'bun.lockb')) ||
        await pathExists(join(this.workspaceRoot, 'bun.lock'))) {
      return 'bun';
    }

    if (await pathExists(join(this.workspaceRoot, 'pnpm-lock.yaml'))) {
      return 'pnpm';
    }

    if (await pathExists(join(this.workspaceRoot, 'yarn.lock'))) {
      return 'yarn';
    }

    if (await pathExists(join(this.workspaceRoot, 'package-lock.json'))) {
      return 'npm';
    }

    // Default to npm if package.json exists but no lockfile
    return 'npm';
  }

  /**
   * Detect Node.js test framework
   */
  private detectNodeTestFramework(deps: Record<string, string>): string | undefined {
    // Unit test frameworks (check most popular/modern first)
    if (deps.vitest) return 'Vitest';
    if (deps.jest) return 'Jest';
    if (deps.mocha) return 'Mocha';
    if (deps.ava) return 'AVA';

    // E2E test frameworks
    if (deps['@playwright/test']) return 'Playwright';
    if (deps.cypress) return 'Cypress';
    if (deps.puppeteer) return 'Puppeteer';

    return undefined;
  }

  /**
   * Detect Node.js linter
   */
  private detectNodeLinter(deps: Record<string, string>): string | undefined {
    if (deps['@biomejs/biome']) return 'Biome';
    if (deps.eslint) return 'ESLint';
    if (deps.oxlint) return 'Oxlint';

    return undefined;
  }

  /**
   * Detect Node.js formatter
   */
  private detectNodeFormatter(deps: Record<string, string>): string | undefined {
    if (deps.prettier) return 'Prettier';
    if (deps['@biomejs/biome']) return 'Biome';
    if (deps.dprint) return 'dprint';

    return undefined;
  }

  /**
   * Detect Node.js build tool
   */
  private detectNodeBuildTool(deps: Record<string, string>): string | undefined {
    if (deps.vite) return 'Vite';
    if (deps.tsup) return 'tsup';
    if (deps.esbuild) return 'esbuild';
    if (deps.rollup) return 'Rollup';
    if (deps.webpack) return 'Webpack';
    if (deps.parcel) return 'Parcel';
    if (deps.turbopack || deps.turbo) return 'Turbopack';

    return undefined;
  }

  /**
   * Analyze Rust project
   */
  private async analyzeRustProject(info: ProjectInfo): Promise<void> {
    const cargoPath = join(this.workspaceRoot, 'Cargo.toml');

    if (!await pathExists(cargoPath)) {
      return;
    }

    info.language = 'Rust';
    info.packageManager = 'cargo';

    // Could parse Cargo.toml for more info like web frameworks (actix, axum, etc.)
    try {
      const cargoContent = await readFile(cargoPath, 'utf-8');

      // Detect web frameworks
      if (cargoContent.includes('actix-web')) {
        info.framework = 'Actix';
      } else if (cargoContent.includes('axum')) {
        info.framework = 'Axum';
      } else if (cargoContent.includes('rocket')) {
        info.framework = 'Rocket';
      } else if (cargoContent.includes('warp')) {
        info.framework = 'Warp';
      } else if (cargoContent.includes('tauri')) {
        info.framework = 'Tauri';
      }
    } catch {
      // Ignore read errors
    }
  }

  /**
   * Analyze Go project
   */
  private async analyzeGoProject(info: ProjectInfo): Promise<void> {
    const goModPath = join(this.workspaceRoot, 'go.mod');

    if (!await pathExists(goModPath)) {
      return;
    }

    info.language = 'Go';
    info.packageManager = 'go';

    // Could parse go.mod for framework detection
    try {
      const goModContent = await readFile(goModPath, 'utf-8');

      // Detect web frameworks
      if (goModContent.includes('github.com/gin-gonic/gin')) {
        info.framework = 'Gin';
      } else if (goModContent.includes('github.com/gofiber/fiber')) {
        info.framework = 'Fiber';
      } else if (goModContent.includes('github.com/labstack/echo')) {
        info.framework = 'Echo';
      } else if (goModContent.includes('github.com/gorilla/mux')) {
        info.framework = 'Gorilla';
      }
    } catch {
      // Ignore read errors
    }
  }

  /**
   * Analyze Python project
   */
  private async analyzePythonProject(info: ProjectInfo): Promise<void> {
    const pyprojectPath = join(this.workspaceRoot, 'pyproject.toml');
    const requirementsPath = join(this.workspaceRoot, 'requirements.txt');
    const poetryLockPath = join(this.workspaceRoot, 'poetry.lock');
    const pipfilePath = join(this.workspaceRoot, 'Pipfile');

    const hasPyproject = await pathExists(pyprojectPath);
    const hasRequirements = await pathExists(requirementsPath);

    if (!hasPyproject && !hasRequirements) {
      return;
    }

    info.language = 'Python';

    // Detect package manager
    if (await pathExists(poetryLockPath)) {
      info.packageManager = 'poetry';
    } else if (await pathExists(pipfilePath)) {
      info.packageManager = 'pipenv';
    } else if (hasPyproject) {
      // Could be uv, hatch, or other modern tools
      info.packageManager = 'pip';
    } else {
      info.packageManager = 'pip';
    }

    // Parse requirements or pyproject for dependencies
    let depsContent = '';
    try {
      if (hasRequirements) {
        depsContent = await readFile(requirementsPath, 'utf-8');
      } else if (hasPyproject) {
        depsContent = await readFile(pyprojectPath, 'utf-8');
      }

      // Detect framework
      if (depsContent.includes('django')) {
        info.framework = 'Django';
      } else if (depsContent.includes('fastapi')) {
        info.framework = 'FastAPI';
      } else if (depsContent.includes('flask')) {
        info.framework = 'Flask';
      } else if (depsContent.includes('starlette')) {
        info.framework = 'Starlette';
      } else if (depsContent.includes('tornado')) {
        info.framework = 'Tornado';
      }

      // Detect test framework
      if (depsContent.includes('pytest')) {
        info.testFramework = 'pytest';
      } else if (depsContent.includes('unittest')) {
        info.testFramework = 'unittest';
      } else if (depsContent.includes('nose')) {
        info.testFramework = 'nose';
      }

      // Detect linter
      if (depsContent.includes('ruff')) {
        info.linter = 'Ruff';
      } else if (depsContent.includes('flake8')) {
        info.linter = 'Flake8';
      } else if (depsContent.includes('pylint')) {
        info.linter = 'Pylint';
      }

      // Detect formatter
      if (depsContent.includes('black')) {
        info.formatter = 'Black';
      } else if (depsContent.includes('ruff')) {
        info.formatter = 'Ruff';
      } else if (depsContent.includes('autopep8')) {
        info.formatter = 'autopep8';
      }
    } catch {
      // Ignore read errors
    }
  }
}
