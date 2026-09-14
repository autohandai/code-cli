/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * `--output-schema`: the final answer of a command-mode run must be one JSON
 * document that validates against a caller-supplied JSON Schema. Validation
 * is local and covers the JSON Schema keywords such schemas use in practice;
 * unknown keywords are ignored rather than refused.
 */
import fs from 'fs-extra';
import path from 'node:path';

export interface OutputSchemaSpec {
  path: string;
  schema: Record<string, unknown>;
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function loadOutputSchema(filePath: string): Promise<OutputSchemaSpec> {
  const resolved = path.resolve(filePath);
  let raw: string;
  try {
    raw = await fs.readFile(resolved, 'utf8');
  } catch {
    throw new Error(`--output-schema file not found: ${resolved}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`--output-schema file is not valid JSON (${resolved}): ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw new Error(`--output-schema must be a JSON object describing a schema (${resolved}).`);
  return { path: resolved, schema: parsed };
}

function jsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function typeMatches(expected: string, actual: string): boolean {
  return expected === actual || (expected === 'number' && actual === 'integer');
}

function resolveRef(ref: string, root: Json): Json | undefined {
  if (!ref.startsWith('#/')) return undefined;
  let current: unknown = root;
  for (const segment of ref.slice(2).split('/')) {
    if (!isRecord(current)) return undefined;
    current = current[segment.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return isRecord(current) ? current : undefined;
}

/** Errors as `<json pointer>: <message>`; an empty list means the value validates. */
export function validateAgainstSchema(value: unknown, schema: Json, root: Json = schema, pointer = ''): string[] {
  const errors: string[] = [];
  const at = pointer || '/';
  if (typeof schema.$ref === 'string') {
    const target = resolveRef(schema.$ref, root);
    if (!target) return [`${at}: unresolvable $ref ${schema.$ref}`];
    return validateAgainstSchema(value, target, root, pointer);
  }
  if (schema.type !== undefined) {
    const expected = Array.isArray(schema.type) ? schema.type.map(String) : [String(schema.type)];
    const actual = jsonType(value);
    if (!expected.some((type) => typeMatches(type, actual))) {
      errors.push(`${at}: expected ${expected.join(' or ')}, got ${actual}`);
      return errors;
    }
  }
  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errors.push(`${at}: must equal ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))) {
    errors.push(`${at}: must be one of ${schema.enum.map((option) => JSON.stringify(option)).join(', ')}`);
  }
  for (const [keyword, combine] of [['allOf', 'all'], ['anyOf', 'any'], ['oneOf', 'one']] as const) {
    const branches = schema[keyword];
    if (!Array.isArray(branches)) continue;
    const results = branches.map((branch) => (isRecord(branch) ? validateAgainstSchema(value, branch, root, pointer) : [`${at}: invalid ${keyword} entry`]));
    const passing = results.filter((result) => result.length === 0).length;
    if (combine === 'all' && passing !== branches.length) errors.push(...results.flat());
    if (combine === 'any' && passing === 0) errors.push(`${at}: matched none of ${branches.length} anyOf schemas`);
    if (combine === 'one' && passing !== 1) errors.push(`${at}: matched ${passing} of ${branches.length} oneOf schemas, expected exactly one`);
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength} characters`);
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) errors.push(`${at}: longer than ${schema.maxLength} characters`);
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${at}: does not match pattern ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${at}: below minimum ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${at}: above maximum ${schema.maximum}`);
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) errors.push(`${at}: must be greater than ${schema.exclusiveMinimum}`);
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) errors.push(`${at}: must be less than ${schema.exclusiveMaximum}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) errors.push(`${at}: fewer than ${schema.minItems} items`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) errors.push(`${at}: more than ${schema.maxItems} items`);
    if (schema.uniqueItems === true && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) errors.push(`${at}: items must be unique`);
    if (isRecord(schema.items)) {
      value.forEach((item, index) => errors.push(...validateAgainstSchema(item, schema.items as Json, root, `${pointer}/${index}`)));
    }
  }
  if (isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === 'string' && !(key in value)) errors.push(`${at}: missing required property "${key}"`);
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (key in value && isRecord(propertySchema)) {
        errors.push(...validateAgainstSchema(value[key], propertySchema, root, `${pointer}/${key}`));
      }
    }
    const additional = schema.additionalProperties;
    if (additional !== undefined && additional !== true) {
      for (const key of Object.keys(value)) {
        if (key in properties) continue;
        if (additional === false) errors.push(`${at}: unexpected property "${key}"`);
        else if (isRecord(additional)) errors.push(...validateAgainstSchema(value[key], additional, root, `${pointer}/${key}`));
      }
    }
  }
  return errors;
}

/** The JSON document inside a reply: fenced or bare, with prose around it tolerated. */
export function extractJsonDocument(text: string): { value: unknown; text: string } | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fenced?.[1], text];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const trimmed = candidate.trim();
    const start = Math.min(...['{', '['].map((ch) => trimmed.indexOf(ch)).filter((index) => index >= 0));
    if (!Number.isFinite(start)) continue;
    const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
    if (end <= start) continue;
    const slice = trimmed.slice(start, end + 1);
    try {
      return { value: JSON.parse(slice), text: slice };
    } catch {
      continue;
    }
  }
  return null;
}

export function buildOutputSchemaInstruction(spec: OutputSchemaSpec): string {
  return [
    '## Output contract',
    'Your final response must be exactly one JSON document that validates against this JSON Schema, with no prose, no Markdown fence, and no explanation before or after it:',
    JSON.stringify(spec.schema),
  ].join('\n');
}

export function buildOutputSchemaRepairInstruction(errors: string[]): string {
  return [
    'Your previous final response did not satisfy the output contract:',
    ...errors.slice(0, 12).map((error) => `- ${error}`),
    'Reply with only the corrected JSON document. Do not call tools.',
  ].join('\n');
}

export interface OutputSchemaCheck {
  ok: boolean;
  /** Canonical JSON text when valid. */
  json?: string;
  value?: unknown;
  errors: string[];
}

export function checkOutputAgainstSchema(reply: string | undefined, spec: OutputSchemaSpec): OutputSchemaCheck {
  const document = reply ? extractJsonDocument(reply) : null;
  if (!document) return { ok: false, errors: ['/: the final response contained no JSON document'] };
  const errors = validateAgainstSchema(document.value, spec.schema);
  return errors.length === 0
    ? { ok: true, json: JSON.stringify(document.value, null, 2), value: document.value, errors: [] }
    : { ok: false, errors };
}
