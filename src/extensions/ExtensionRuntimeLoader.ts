/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileFunction, constants } from 'node:vm';
import { build, transform as transformSource } from 'esbuild';
import { transform } from 'sucrase';
import * as Ink from 'ink';
import React from 'react';
import * as ReactJsxRuntime from 'react/jsx-runtime';
import * as ReactJsxDevRuntime from 'react/jsx-dev-runtime';

interface RuntimePluginBuilder {
  onResolve(options: { filter: RegExp; namespace?: string }, resolve: (args: { path: string }) => { path: string; namespace: string }): void;
  onLoad(options: { filter: RegExp; namespace?: string }, load: (args: { path: string }) => Promise<{
    contents: string; loader: 'js' | 'json'; resolveDir?: string;
  }>): void;
}

interface BunBuildRuntime {
  Transpiler: new (options: { loader: 'js'; define: Record<string, string>; target: 'node' }) => {
    transformSync(source: string): string;
  };
  build(options: {
    entrypoints: string[]; format: 'esm'; target: 'node'; external: string[];
    plugins: Array<{ name: string; setup(builder: RuntimePluginBuilder): void }>;
  }): Promise<{ success: boolean; outputs: Array<{ text(): Promise<string> }>; logs: unknown[] }>;
}

interface PreparedModule {
  file: string;
  entrypoints: string[];
  code: string;
  signature: string;
  dependencies: Map<string, string>;
}

async function fileStamp(file: string): Promise<string> {
  const stat = await fs.stat(file);
  return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
}

export class ExtensionRuntimeLoader {
  private readonly modules = new Map<string, PreparedModule>();

  async prepare(entrypoints: string[], force = false): Promise<PreparedModule> {
    const file = entrypoints[0];
    if (!file) throw new Error('Extension runtime graph has no entrypoints');
    const cached = this.modules.get(file);
    if (cached && !force && cached.entrypoints.length === entrypoints.length
      && cached.entrypoints.every((entrypoint, index) => entrypoint === entrypoints[index])) {
      const unchanged = await Promise.all([...cached.dependencies].map(async ([dependency, stamp]) =>
        await fileStamp(dependency).catch(() => '') === stamp));
      if (unchanged.every(Boolean)) return cached;
    }
    const dependencies = new Map<string, string>();
    const bun = (globalThis as typeof globalThis & { Bun?: BunBuildRuntime }).Bun;
    const virtualEntry = `${file}.autohand-entry`;
    const virtualSource = `export const loadRuntimes = [${entrypoints
      .map((entrypoint) => `() => import(${JSON.stringify(entrypoint)})`).join(',')}];`;
    const plugin = {
      name: 'extension-source-locations',
      setup(builder: RuntimePluginBuilder) {
        builder.onResolve({ filter: /\.autohand-entry$/ }, ({ path: entrypoint }) => ({
          path: entrypoint, namespace: 'autohand-extension-entry',
        }));
        builder.onResolve({ filter: /.*/, namespace: 'autohand-extension-entry' }, ({ path: entrypoint }) => ({
          path: entrypoint, namespace: 'file',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'autohand-extension-entry' }, async () => ({
          contents: virtualSource, loader: 'js', ...(bun ? {} : { resolveDir: path.dirname(file) }),
        }));
        builder.onLoad({ filter: /\.[cm]?js$/ }, async ({ path: sourceFile }) => {
          const before = await fileStamp(sourceFile);
          const source = await fs.readFile(sourceFile, 'utf8');
          const define = {
            'import.meta.url': JSON.stringify(pathToFileURL(sourceFile).href),
            'import.meta.dirname': JSON.stringify(path.dirname(sourceFile)),
            'import.meta.filename': JSON.stringify(sourceFile),
            '__dirname': JSON.stringify(path.dirname(sourceFile)),
            '__filename': JSON.stringify(sourceFile),
          };
          const contents = bun
            ? new bun.Transpiler({ loader: 'js', target: 'node', define }).transformSync(source)
            : (await transformSource(source, { loader: 'js', format: 'esm', sourcefile: sourceFile, define })).code;
          if (await fileStamp(sourceFile) !== before) throw new Error(`Extension file changed while loading: ${sourceFile}`);
          dependencies.set(sourceFile, before);
          return { contents, loader: 'js', ...(bun ? {} : { resolveDir: path.dirname(sourceFile) }) };
        });
        builder.onLoad({ filter: /\.json$/ }, async ({ path: sourceFile }) => {
          const stamp = await fileStamp(sourceFile);
          const contents = await fs.readFile(sourceFile, 'utf8');
          if (await fileStamp(sourceFile) !== stamp) throw new Error(`Extension file changed while loading: ${sourceFile}`);
          dependencies.set(sourceFile, stamp);
          return { contents, loader: 'json', ...(bun ? {} : { resolveDir: path.dirname(sourceFile) }) };
        });
      },
    };
    const external = ['react', 'react/*', 'ink'];
    let bundled: string;
    if (bun) {
      const result = await bun.build({ entrypoints: [virtualEntry], format: 'esm', target: 'node', external, plugins: [plugin] });
      if (!result.success) throw new Error(`Extension build failed: ${result.logs.map(String).join('\n')}`);
      bundled = await result.outputs[0].text();
    } else {
      const result = await build({ entryPoints: [virtualEntry], bundle: true, write: false,
        format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent', external, plugins: [plugin] });
      bundled = result.outputFiles[0].text;
    }
    const code = transform(bundled, {
      transforms: ['imports'],
      preserveDynamicImport: true,
      filePath: file,
    }).code;
    const prepared = { file, entrypoints: [...entrypoints], code, dependencies, signature: createHash('sha256').update(code).digest('hex') };
    this.modules.set(file, prepared);
    return prepared;
  }

  async evaluate(prepared: PreparedModule): Promise<unknown> {
    const localRequire = createRequire(prepared.file);
    const require = (specifier: string): unknown => {
      if (specifier === 'react') return React;
      if (specifier === 'react/jsx-runtime') return ReactJsxRuntime;
      if (specifier === 'react/jsx-dev-runtime') return ReactJsxDevRuntime;
      if (specifier === 'ink') return Ink;
      return localRequire(specifier);
    };
    const module = { exports: {} };
    // A fresh function owns each generation; native ESM's permanent URL cache never retains edits.
    const evaluate = compileFunction(`return (async function () {\n${prepared.code}\n}).call(exports);`,
      ['exports', 'module', 'require', '__filename', '__dirname'], {
        filename: prepared.file,
        importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
      });
    await evaluate(module.exports, module, require, prepared.file, path.dirname(prepared.file));
    return module.exports;
  }

  retain(files: Iterable<string>): void {
    const keep = new Set(files);
    for (const file of this.modules.keys()) {
      if (!keep.has(file)) this.modules.delete(file);
    }
  }

  clear(): void {
    this.modules.clear();
  }
}
