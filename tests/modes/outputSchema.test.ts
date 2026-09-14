/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildOutputSchemaInstruction,
  buildOutputSchemaRepairInstruction,
  checkOutputAgainstSchema,
  extractJsonDocument,
  loadOutputSchema,
  validateAgainstSchema,
} from '../../src/modes/outputSchema.js';

const schema = {
  type: 'object',
  required: ['summary', 'files'],
  additionalProperties: false,
  properties: {
    summary: { type: 'string', minLength: 1 },
    files: { type: 'integer', minimum: 0 },
    risk: { enum: ['low', 'medium', 'high'] },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 3, uniqueItems: true },
    owner: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    nested: { $ref: '#/$defs/nested' },
  },
  $defs: { nested: { type: 'object', properties: { ok: { const: true } }, required: ['ok'] } },
};

describe('validateAgainstSchema', () => {
  it('accepts a conforming document', () => {
    expect(validateAgainstSchema({ summary: 'done', files: 2, risk: 'low', tags: ['a', 'b'], owner: null, nested: { ok: true } }, schema)).toEqual([]);
  });

  it('reports every violation with a JSON pointer', () => {
    const errors = validateAgainstSchema({ summary: '', files: 1.5, risk: 'none', tags: ['a', 'a', 'b', 'c'], owner: 3, nested: { ok: false }, extra: 1 }, schema);
    expect(errors).toEqual(expect.arrayContaining([
      '/summary: shorter than 1 characters',
      '/files: expected integer, got number',
      '/risk: must be one of "low", "medium", "high"',
      '/tags: more than 3 items',
      '/tags: items must be unique',
      '/owner: matched none of 2 anyOf schemas',
      '/nested/ok: must equal true',
      '/: unexpected property "extra"',
    ]));
    expect(validateAgainstSchema({ files: 1 }, schema)).toContain('/: missing required property "summary"');
    expect(validateAgainstSchema('text', schema)).toEqual(['/: expected object, got string']);
  });

  it('handles type unions, oneOf, and string patterns', () => {
    expect(validateAgainstSchema(null, { type: ['string', 'null'] })).toEqual([]);
    expect(validateAgainstSchema(2, { oneOf: [{ type: 'integer' }, { type: 'number' }] })).toEqual(['/: matched 2 of 2 oneOf schemas, expected exactly one']);
    expect(validateAgainstSchema('abc', { pattern: '^\\d+$' })).toEqual(['/: does not match pattern ^\\d+$']);
    expect(validateAgainstSchema({}, { $ref: '#/missing' })).toEqual(['/: unresolvable $ref #/missing']);
  });
});

describe('extractJsonDocument and checkOutputAgainstSchema', () => {
  it('reads fenced, bare, and prose-wrapped JSON and rejects replies without any', () => {
    expect(extractJsonDocument('Here you go:\n```json\n{"a": 1}\n```\nDone.')?.value).toEqual({ a: 1 });
    expect(extractJsonDocument('[1, 2]')?.value).toEqual([1, 2]);
    expect(extractJsonDocument('Result: {"a": {"b": [1]}} thanks')?.value).toEqual({ a: { b: [1] } });
    expect(extractJsonDocument('no json here')).toBeNull();
    expect(extractJsonDocument('{"broken": ')).toBeNull();
  });

  it('returns canonical JSON for a valid reply and the errors otherwise', () => {
    const spec = { path: '/s.json', schema };
    const valid = checkOutputAgainstSchema('```json\n{"files":2,"summary":"ok"}\n```', spec);
    expect(valid).toMatchObject({ ok: true, value: { files: 2, summary: 'ok' } });
    expect(valid.json).toBe(JSON.stringify({ files: 2, summary: 'ok' }, null, 2));
    expect(checkOutputAgainstSchema('{"summary":"ok"}', spec)).toEqual({ ok: false, errors: ['/: missing required property "files"'] });
    expect(checkOutputAgainstSchema(undefined, spec).errors[0]).toContain('contained no JSON document');
  });

  it('builds the contract and repair instructions', () => {
    const contract = buildOutputSchemaInstruction({ path: '/s.json', schema: { type: 'object' } });
    expect(contract).toContain('## Output contract');
    expect(contract).toContain('{"type":"object"}');
    const repair = buildOutputSchemaRepairInstruction(['/: missing required property "files"']);
    expect(repair).toContain('- /: missing required property "files"');
    expect(repair).toContain('Do not call tools.');
  });
});

describe('loadOutputSchema', () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.remove(root))); });

  it('loads a schema object and rejects missing, malformed, or non-object files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-schema-'));
    roots.push(root);
    const good = path.join(root, 'schema.json');
    await fs.writeJson(good, { type: 'object' });
    await expect(loadOutputSchema(good)).resolves.toEqual({ path: good, schema: { type: 'object' } });
    await expect(loadOutputSchema(path.join(root, 'missing.json'))).rejects.toThrow('file not found');
    await fs.writeFile(path.join(root, 'bad.json'), '{');
    await expect(loadOutputSchema(path.join(root, 'bad.json'))).rejects.toThrow('not valid JSON');
    await fs.writeJson(path.join(root, 'list.json'), [1]);
    await expect(loadOutputSchema(path.join(root, 'list.json'))).rejects.toThrow('must be a JSON object');
  });
});
