/** @license Apache-2.0 */
import { appendFileSync } from 'node:fs';

if (!process.env.AUTOHAND_HOME) throw new Error('The resize fixture requires an isolated AUTOHAND_HOME');

const terminal = process.env.AUTOHAND_RESIZE_TERMINAL;
if (terminal) process.env.TERM = terminal;
const tracePath = process.env.AUTOHAND_RESIZE_WRITE_TRACE;
const viewportMarkers = process.argv.includes('--viewport-markers');
if (tracePath || viewportMarkers) {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let tracedBytes = 0;
  const write: typeof process.stdout.write = (chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): boolean => {
    const value = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    const output = process.argv.includes('--unsupported-sync') ? value.replaceAll(/\x1b\[\?2026[hl]/g, '') : value;
    const encoding = typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined;
    const complete = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
    const marker = viewportMarkers ? `\x1b]777;resize-fixture;${process.stdout.columns};${process.stdout.rows}\x07` : '';
    const result = originalWrite(marker + output, encoding, complete);
    if (tracePath) {
      const record = JSON.stringify({ columns: process.stdout.columns, rows: process.stdout.rows, terminal: process.env.TERM, output }) + '\n';
      tracedBytes += Buffer.byteLength(record);
      if (tracedBytes > 4 * 1024 * 1024) throw new Error('Resize fixture exceeded its bounded write trace');
      appendFileSync(tracePath, record);
    }
    return result;
  };
  process.stdout.write = write;
}

const { InkRenderer } = await import('../../ui/ink/InkRenderer.js');

let streamTimer: ReturnType<typeof setInterval> | undefined;
let streamed = 0;
const renderer = new InkRenderer({
  fullScreenMode: process.argv.includes('--full-screen'),
  onInstruction: () => {},
  onEscape: () => {
    clearInterval(streamTimer);
    renderer.setWorking(false);
    renderer.setFinalResponse(`RESIZE_STREAM_COMPLETE ${streamed}`);
  },
  onCtrlC: () => {
    clearInterval(streamTimer);
    void renderer.stop().then(() => {
      process.stdout.write('\nRESIZE_PTY_EXIT\n', () => process.exit(0));
    });
  },
});
renderer.addUserMessage('Resize transcript remains visible');
renderer.setFinalResponse('RESIZE_HISTORY retained text');
if (process.argv.includes('--multiline')) renderer.setInput(`preserved draft\n${'wrapped composer '.repeat(6)}tail`);
if (process.argv.includes('--streaming')) {
  renderer.addUserMessage('Resize active request');
  renderer.setWorking(true, 'Resize streaming fixture');
}
renderer.start();
if (process.argv.includes('--streaming')) {
  streamTimer = setInterval(() => {
    streamed += 1;
    renderer.setStreamingResponse(`RESIZE_STREAM ${streamed} retained streamed text`);
  }, 40);
}
