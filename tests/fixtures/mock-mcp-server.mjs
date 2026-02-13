#!/usr/bin/env node
/**
 * Minimal MCP server for testing.
 * Implements the MCP protocol over stdio (JSON-RPC 2.0).
 * Provides a single "echo_test" tool.
 */

import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin });

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // ignore non-JSON
  }

  // Handle JSON-RPC notifications (no id)
  if (msg.id === undefined) {
    return;
  }

  switch (msg.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'mock-mcp-server', version: '1.0.0' },
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
});

// Keep process alive
process.stdin.resume();
