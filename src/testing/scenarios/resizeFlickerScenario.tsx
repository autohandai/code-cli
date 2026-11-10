/** @license Apache-2.0 */
import { appendFileSync } from 'node:fs';
import { createResizeWriteMetadata, observeResizeWrite, resizeWritePayload } from './resizeWriteMetadata.js';

if (!process.env.AUTOHAND_HOME) throw new Error('The resize fixture requires an isolated AUTOHAND_HOME');

const terminal = process.env.AUTOHAND_RESIZE_TERMINAL;
if (terminal) process.env.TERM = terminal;
const tracePath = process.env.AUTOHAND_RESIZE_WRITE_TRACE;
const metadataPath = process.env.AUTOHAND_RESIZE_WRITE_METADATA;
const writeMetadata = metadataPath ? createResizeWriteMetadata(metadataPath) : undefined;
const viewportMarkers = process.argv.includes('--viewport-markers');
let streamed = 0;
if (tracePath || metadataPath || viewportMarkers) {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let tracedBytes = 0;
  let sequence = 0;
  const write: typeof process.stdout.write = (chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): boolean => {
    const encoding = typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined;
    const complete = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
    const marker = viewportMarkers ? `\x1b]777;resize-fixture;${process.stdout.columns};${process.stdout.rows}\x07` : '';
    const payload = resizeWritePayload(chunk, encoding, { marker, unsupportedSync: process.argv.includes('--unsupported-sync') });
    const current = ++sequence;
    const result = writeMetadata ? observeResizeWrite({
      sequence: current, bytes: payload.bytes, record: writeMetadata.record, complete,
      snapshot: () => ({ timestamp: Date.now() / 1000, columns: process.stdout.columns, rows: process.stdout.rows, streamed }),
      write: callback => originalWrite(payload.chunk, encoding, callback),
    }) : originalWrite(payload.chunk, encoding, complete);
    if (tracePath) {
      const value = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
      const output = process.argv.includes('--unsupported-sync') ? value.replaceAll(/\x1b\[\?2026[hl]/g, '') : value;
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
      process.stdout.write('\nRESIZE_PTY_EXIT\n', () => {
        void (writeMetadata?.flush() ?? Promise.resolve()).then(() => process.exit(0));
      });
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
