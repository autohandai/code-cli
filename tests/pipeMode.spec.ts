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
