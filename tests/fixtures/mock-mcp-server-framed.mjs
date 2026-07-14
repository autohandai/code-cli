#!/usr/bin/env node
/**
 * MCP test server using Content-Length framing (stdio).
 * This matches the MCP/LSP-style transport used by modern MCP servers.
 */

import { appendFileSync } from 'node:fs';

let inputBuffer = Buffer.alloc(0);

function record(event) {
  if (!process.env.MCP_TEST_EVENT_LOG) return;
  appendFileSync(process.env.MCP_TEST_EVENT_LOG, `${JSON.stringify(event)}\n`);
}

record({ event: 'started', pid: process.pid });

function send(obj) {
  const json = JSON.stringify(obj);
  const payload = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
  process.stdout.write(payload);
}

function handleRequest(msg) {
  if (msg.id === undefined) {
    if (msg.method === 'notifications/cancelled') {
      record({ event: 'cancelled', ...msg.params });
    }
    return;
  }

  switch (msg.method) {
    case 'initialize':
      record({ event: 'initialize_received', pid: process.pid });
      setTimeout(() => {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'mock-mcp-server-framed', version: '1.0.0' },
          },
        });
      }, Number(process.env.MCP_TEST_INITIALIZE_DELAY_MS ?? 0));
      break;

    case 'tools/list':
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: [
            {
              name: 'echo_test',
              description: 'Echoes back the input message',
              inputSchema: {
                type: 'object',
                properties: {
                  message: { type: 'string', description: 'Message to echo' },
                },
                required: ['message'],
              },
            },
            {
              name: 'slow_test',
              description: 'Returns after a delay, even after cancellation',
              inputSchema: {
                type: 'object',
                properties: {
                  delayMs: { type: 'number' },
                },
              },
            },
          ],
        },
      });
      break;

    case 'tools/call':
      if (msg.params?.name === 'slow_test') {
        record({ event: 'request', requestId: msg.id });
        setTimeout(() => {
          record({ event: 'late_response', requestId: msg.id });
          send({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              content: [{ type: 'text', text: 'Slow result' }],
            },
          });
        }, msg.params?.arguments?.delayMs ?? 150);
        break;
      }

      if (msg.params?.name === 'echo_test') {
        if (
          msg.params?.arguments
          && typeof msg.params.arguments === 'object'
          && 'type' in msg.params.arguments
        ) {
          send({
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32602, message: 'Unexpected internal field: type' },
          });
          break;
        }

        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            content: [
              {
                type: 'text',
                text: `Echo: ${msg.params?.arguments?.message ?? ''}`,
              },
            ],
          },
        });
      } else {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32601, message: `Unknown tool: ${msg.params?.name}` },
        });
      }
      break;

    default:
      send({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: `Method not found: ${msg.method}` },
      });
  }
}

function processInputBuffer() {
  while (inputBuffer.length > 0) {
    const headerEnd = inputBuffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;

    const headers = inputBuffer.subarray(0, headerEnd).toString('utf8');
    const match = headers.match(/content-length:\s*(\d+)/i);
    if (!match) {
      // Invalid frame, drop header block and continue.
      inputBuffer = inputBuffer.subarray(headerEnd + 4);
      continue;
    }

    const contentLength = Number.parseInt(match[1], 10);
    const payloadStart = headerEnd + 4;
    const payloadEnd = payloadStart + contentLength;

    if (inputBuffer.length < payloadEnd) return;

    const json = inputBuffer.subarray(payloadStart, payloadEnd).toString('utf8');
    inputBuffer = inputBuffer.subarray(payloadEnd);

    try {
      const msg = JSON.parse(json);
      handleRequest(msg);
    } catch {
      // Ignore malformed payloads
    }
  }
}

process.stdin.on('data', (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  processInputBuffer();
});

process.stdin.resume();
