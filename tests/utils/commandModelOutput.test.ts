import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CommandModelOutput, resolveMaxCommandOutputChars } from '../../src/utils/commandModelOutput.js';
const directories: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
describe('model command output', () => {
  it.each([30000, 60000])('uses a compact overflow preview within the %s ceiling while preserving intact logs', async limit => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ah-model-preview-')); directories.push(directory);
    const intact = 'INTACT\n' + 'x'.repeat(20000);
    const short = new CommandModelOutput(limit, directory);
    short.append(intact);
    expect(short.finish(intact)).toBe(intact);
    const raw = 'HEAD\n' + 'x'.repeat(limit * 10) + '\nTAIL';
    const long = new CommandModelOutput(limit, directory);
    long.append(raw);
    const preview = long.finish('$ command\n' + raw);
    expect(preview.length).toBeLessThanOrEqual(limit / 2);
    expect(preview).toContain('HEAD');
    expect(preview).toContain('TAIL');
    expect(preview).toContain('output truncated:');
    expect(await readFile(long.filePath!, 'utf8')).toBe(raw);
  });

  it('keeps short output intact and respects the environment override', () => {
    expect(resolveMaxCommandOutputChars()).toBe(30000);
    vi.stubEnv('AUTOHAND_MAX_COMMAND_OUTPUT_CHARS', '4096');
    expect(resolveMaxCommandOutputChars(8000)).toBe(4096);
    const capture = new CommandModelOutput(4096);
    capture.append('a short log');
    expect(capture.finish('a short log')).toBe('a short log');
  });
  it('archives every raw chunk beyond the UI limit and bounds the model head and tail together', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ah-model-output-')); directories.push(directory);
    const capture = new CommandModelOutput(30000, directory);
    const chunks = ['HEAD\n', 'x'.repeat(1024 * 1024 + 100000), '\nSTDERR\n', 'z'.repeat(50000), '\n400000\n'];
    chunks.forEach(chunk => capture.append(chunk));
    const model = capture.finish(chunks.join(''));
    expect(model.length).toBeLessThanOrEqual(30000);
    expect(model).toContain('HEAD'); expect(model).toContain('400000'); expect(model).toContain('output truncated:');
    expect(capture.filePath).toBeDefined();
    expect(await readFile(capture.filePath!, 'utf8')).toBe(chunks.join(''));
    expect((await stat(capture.filePath!)).mode & 0o777).toBe(0o600);
    expect(model).toContain(capture.filePath);
  });
  it('reports an unavailable archive without inventing a path and still caps output', () => {
    const capture = new CommandModelOutput(2000);
    capture.append('x'.repeat(10000));
    const output = capture.finish('x'.repeat(10000));
    expect(output.length).toBeLessThanOrEqual(2000);
    expect(output).toContain('not saved');
    expect(capture.filePath).toBeUndefined();
  });

  it('keeps the smallest observation limit when the archive path and command header are long', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ah-model-long-path-')); directories.push(directory);
    const session = path.join(directory, ...Array.from({ length: 6 }, () => 'a'.repeat(100)));
    const raw = 'HEAD\n' + 'x'.repeat(3000) + '\nTAIL';
    const capture = new CommandModelOutput(1024, session);
    capture.append(raw);
    const output = capture.finish('$ ' + 'c'.repeat(500) + '\n' + raw);
    expect(output.length).toBeLessThanOrEqual(1024);
    expect(output).toContain(path.basename(capture.filePath!));
    expect(await readFile(capture.filePath!, 'utf8')).toBe(raw);
    expect(output).toContain('TAIL');
  });

  it.each([1024, 30000])('preserves Unicode boundaries in compact head/tail output with limit %s', limit => {
    const capture = new CommandModelOutput(limit);
    capture.append('😀'.repeat(limit));
    const output = capture.finish('$ emoji\n' + '😀'.repeat(limit));
    expect(output.length).toBeLessThanOrEqual(limit);
    expect(output).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });
});
