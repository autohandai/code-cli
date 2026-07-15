/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json' with { type: 'json' };
import {
  EXTENSION_API_VERSION,
  EXTENSION_ID_PATTERN,
  EXTENSION_SCHEMA_VERSION,
  EXTENSION_SEMVER_PATTERN,
} from '../../src/extensions/schema.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SCHEMA_PATH = path.join(ROOT, 'schema', 'autohand.extension.schema.json');
const EXAMPLES_ROOT = path.join(ROOT, 'examples', 'extensions');

interface ExtensionJsonSchema {
  $id: string;
  additionalProperties: boolean;
  properties: {
    schemaVersion: { const: number };
    extensionApi: { const: number };
    id: { pattern: string };
    version: { pattern: string };
    contributes: { additionalProperties: boolean };
  };
}

describe('extension JSON Schema artifact', () => {
  it('matches the runtime API constants and strict identity rules', async () => {
    const schema = await fs.readJson(SCHEMA_PATH) as ExtensionJsonSchema;

    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.contributes.additionalProperties).toBe(false);
    expect(schema.properties.schemaVersion.const).toBe(EXTENSION_SCHEMA_VERSION);
    expect(schema.properties.extensionApi.const).toBe(EXTENSION_API_VERSION);
    expect(schema.properties.id.pattern).toBe(EXTENSION_ID_PATTERN.source);
    expect(schema.properties.version.pattern).toBe(EXTENSION_SEMVER_PATTERN.source);
  });

  it('is referenced by every portable example manifest', async () => {
    const schema = await fs.readJson(SCHEMA_PATH) as ExtensionJsonSchema;
    const ids = await fs.readdir(EXAMPLES_ROOT);

    for (const id of ids) {
      const manifest = await fs.readJson(path.join(EXAMPLES_ROOT, id, 'autohand.extension.json')) as {
        $schema?: string;
      };
      expect(manifest.$schema).toBe(schema.$id);
    }
  });

  it('ships the schema, examples, and author documentation in the npm package', () => {
    expect(packageJson.files).toEqual(expect.arrayContaining([
      'schema',
      'examples/extensions',
      'docs/extensions.md',
      'docs/extension-authoring.md',
    ]));
  });
});
