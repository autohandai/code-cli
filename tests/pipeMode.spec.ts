/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------- PipeOutputHandler ----------

describe('PipeOutputHandler', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>;
  let stderrWrite: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('writeFinalResult', () => {
    it('writes text followed by newline to stdout', async () => {
      const { PipeOutputHandler } = await import('../src/modes/pipeMode.js');
      const handler = new PipeOutputHandler({ verbose: false, jsonOutput: false });

      handler.writeFinalResult('hello world');

      expect(stdoutWrite).toHaveBeenCalledWith('hello world\n');
    });

    it('writes empty string with newline to stdout', async () => {
      const { PipeOutputHandler } = await import('../src/modes/pipeMode.js');
      const handler = new PipeOutputHandler({ verbose: false, jsonOutput: false });

      handler.writeFinalResult('');

      expect(stdoutWrite).toHaveBeenCalledWith('\n');
    });
  });

  describe('writeError', () => {
    it('writes error message to stderr in text mode', async () => {
      const { PipeOutputHandler } = await import('../src/modes/pipeMode.js');
      const handler = new PipeOutputHandler({ verbose: false, jsonOutput: false });

      handler.writeError('something went wrong');

      expect(stderrWrite).toHaveBeenCalledWith('Error: something went wrong\n');
      expect(stdoutWrite).not.toHaveBeenCalled();
    });

    it('writes JSON error object to stdout in json mode', async () => {
      const { PipeOutputHandler } = await import('../src/modes/pipeMode.js');
      const handler = new PipeOutputHandler({ verbose: false, jsonOutput: true });

      handler.writeError('something went wrong');

      const expectedJson = JSON.stringify({ type: 'error', message: 'something went wrong' }) + '\n';
      expect(stdoutWrite).toHaveBeenCalledWith(expectedJson);
      expect(stderrWrite).not.toHaveBeenCalled();
    });
  });

  describe('writeProgress', () => {
    it('writes progress message to stderr in verbose mode', async () => {
      const { PipeOutputHandler } = await import('../src/modes/pipeMode.js');
      const handler = new PipeOutputHandler({ verbose: true, jsonOutput: false });

      handler.writeProgress('processing file...');

      expect(stderrWrite).toHaveBeenCalledWith('processing file...\n');
    });

    it('suppresses progress message in non-verbose mode', async () => {
      const { PipeOutputHandler } = await import('../src/modes/pipeMode.js');
      const handler = new PipeOutputHandler({ verbose: false, jsonOutput: false });

      handler.writeProgress('processing file...');

      expect(stderrWrite).not.toHaveBeenCalled();
      expect(stdoutWrite).not.toHaveBeenCalled();
    });
  });

  describe('writeJsonLine', () => {
    it('writes JSON-stringified data followed by newline to stdout', async () => {
      const { PipeOutputHandler } = await import('../src/modes/pipeMode.js');
      const handler = new PipeOutputHandler({ verbose: false, jsonOutput: true });

      const data = { type: 'result', content: 'done', count: 42 };
      handler.writeJsonLine(data);

      expect(stdoutWrite).toHaveBeenCalledWith(JSON.stringify(data) + '\n');
    });

    it('handles simple string data', async () => {
      const { PipeOutputHandler } = await import('../src/modes/pipeMode.js');
      const handler = new PipeOutputHandler({ verbose: false, jsonOutput: true });

      handler.writeJsonLine('hello');

      expect(stdoutWrite).toHaveBeenCalledWith(JSON.stringify('hello') + '\n');
    });

    it('handles arrays', async () => {
      const { PipeOutputHandler } = await import('../src/modes/pipeMode.js');
      const handler = new PipeOutputHandler({ verbose: false, jsonOutput: true });

      handler.writeJsonLine([1, 2, 3]);

      expect(stdoutWrite).toHaveBeenCalledWith(JSON.stringify([1, 2, 3]) + '\n');
    });
  });
});

// ---------- Pipe stdin composition (wiring test) ----------

describe('pipe stdin → buildPipePrompt composition', () => {
  let mockStdin: import('node:events').EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { EventEmitter } = await import('node:events');
    mockStdin = Object.assign(new EventEmitter(), {
      setEncoding: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('combines piped stdin with user prompt into a single instruction', async () => {
    const { readPipedStdin } = await import('../src/utils/stdinDetector.js');
    const { buildPipePrompt } = await import('../src/modes/pipeMode.js');

    // Simulate: git diff HEAD~1 | autohand -p "summarize these changes"
    const userPrompt = 'summarize these changes';
    const diffContent = 'diff --git a/file.ts\n-old line\n+new line';

    const readPromise = readPipedStdin(5_000, mockStdin as unknown as NodeJS.ReadableStream);
    mockStdin.emit('data', diffContent);
    mockStdin.emit('end');
    const pipedInput = await readPromise;

    const instruction = buildPipePrompt(userPrompt, pipedInput);

    expect(instruction).toContain('summarize these changes');
    expect(instruction).toContain('diff --git a/file.ts');
    expect(instruction).toContain('-old line');
    expect(instruction).toContain('+new line');
    expect(instruction).toContain('```');
  });

  it('passes prompt through unchanged when stdin read returns null', async () => {
    const { readPipedStdin } = await import('../src/utils/stdinDetector.js');
    const { buildPipePrompt } = await import('../src/modes/pipeMode.js');

    const userPrompt = 'explain this code';

    // Simulate stdin error → null
    const readPromise = readPipedStdin(5_000, mockStdin as unknown as NodeJS.ReadableStream);
    mockStdin.emit('error', new Error('broken pipe'));
    const pipedInput = await readPromise;

    const instruction = buildPipePrompt(userPrompt, pipedInput);

    expect(instruction).toBe('explain this code');
  });

  it('handles large piped input without truncation', async () => {
    const { readPipedStdin } = await import('../src/utils/stdinDetector.js');
    const { buildPipePrompt } = await import('../src/modes/pipeMode.js');

    const userPrompt = 'summarize';
    const largeDiff = Array.from({ length: 500 }, (_, i) => `+line ${i}`).join('\n');

    const readPromise = readPipedStdin(5_000, mockStdin as unknown as NodeJS.ReadableStream);
    mockStdin.emit('data', largeDiff);
    mockStdin.emit('end');
    const pipedInput = await readPromise;

    const instruction = buildPipePrompt(userPrompt, pipedInput);

    expect(instruction).toContain('+line 0');
    expect(instruction).toContain('+line 499');
    expect(instruction).toContain('summarize');
  });
});

// ---------- buildPipePrompt ----------

describe('buildPipePrompt', () => {
  it('returns userPrompt as-is when pipedInput is null', async () => {
    const { buildPipePrompt } = await import('../src/modes/pipeMode.js');

    const result = buildPipePrompt('explain this code', null);

    expect(result).toBe('explain this code');
  });

  it('returns userPrompt as-is when pipedInput is undefined', async () => {
    const { buildPipePrompt } = await import('../src/modes/pipeMode.js');

    const result = buildPipePrompt('explain this code', undefined as unknown as string | null);

    expect(result).toBe('explain this code');
  });

  it('returns userPrompt as-is when pipedInput is empty string', async () => {
    const { buildPipePrompt } = await import('../src/modes/pipeMode.js');

    const result = buildPipePrompt('explain this code', '');

    expect(result).toBe('explain this code');
  });

  it('prepends piped input in a fenced code block when pipedInput has content', async () => {
    const { buildPipePrompt } = await import('../src/modes/pipeMode.js');

    const result = buildPipePrompt('explain', 'const x = 1;');

    const expected = `Here is the input from stdin:\n\n\`\`\`\nconst x = 1;\n\`\`\`\n\nexplain`;
    expect(result).toBe(expected);
  });

  it('handles multi-line piped input', async () => {
    const { buildPipePrompt } = await import('../src/modes/pipeMode.js');

    const pipedInput = 'line 1\nline 2\nline 3';
    const result = buildPipePrompt('summarize', pipedInput);

    const expected = `Here is the input from stdin:\n\n\`\`\`\nline 1\nline 2\nline 3\n\`\`\`\n\nsummarize`;
    expect(result).toBe(expected);
  });
});
