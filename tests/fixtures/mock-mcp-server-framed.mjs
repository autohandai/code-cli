#!/usr/bin/env node
/**
 * MCP test server using Content-Length framing (stdio).
 * This matches the MCP/LSP-style transport used by modern MCP servers.
 */

let inputBuffer = Buffer.alloc(0);

function send(obj) {
  const json = JSON.stringify(obj);
  const payload = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
  process.stdout.write(payload);
}

function handleRequest(msg) {
  // Ignore notifications (no id)
  if (msg.id === undefined) return;

  switch (msg.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'mock-mcp-server-framed', version: '1.0.0' },
        },
      });
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
          ],
        },
      });
      break;

    case 'tools/call':
      if (msg.params?.name === 'echo_test') {
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
