#!/usr/bin/env node
/**
 * Minimal MCP server for testing.
 * Implements the MCP protocol over stdio (JSON-RPC 2.0).
 * Provides text and screenshot tools.
 */

import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin });
const initializeDelayMs = Number(process.env.MCP_TEST_INITIALIZE_DELAY_MS ?? 0);
const screenshotData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    if (line.trim()) {
      send({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
    }
    return;
  }

  // Handle JSON-RPC notifications (no id)
  if (msg.id === undefined) {
    return;
  }

  switch (msg.method) {
    case 'initialize':
      setTimeout(() => {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'mock-mcp-server', version: '1.0.0' },
          },
        });
      }, initializeDelayMs);
      break;

    case 'tools/list':
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: [
            {
              name: 'list_windows',
              description: 'List the Spotify fixture window',
              inputSchema: { type: 'object', properties: { pid: { type: 'number' } }, required: ['pid'] },
            },
            {
              name: 'get_window_state',
              description: 'Inspect the exact Spotify fixture window',
              inputSchema: { type: 'object', properties: { pid: { type: 'number' }, window_id: { type: 'number' } }, required: ['pid', 'window_id'] },
            },
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
              name: 'screenshot_test',
              description: 'Returns a tiny desktop screenshot fixture',
              inputSchema: {
                type: 'object',
                properties: {},
              },
            },
          ],
        },
      });
      break;

    case 'tools/call':
      if (msg.params?.name === 'list_windows') {
        send({ jsonrpc: '2.0', id: msg.id, result: {
          content: [{ type: 'text', text: 'Found 1 window(s).' }],
          structuredContent: { windows: [{ pid: 6844, window_id: 280, title: 'Spotify Free' }] },
        } });
      } else if (msg.params?.name === 'get_window_state') {
        const valid = msg.params.arguments?.pid === 6844 && msg.params.arguments?.window_id === 280;
        send({ jsonrpc: '2.0', id: msg.id, result: {
          isError: !valid,
          content: [{ type: 'text', text: valid ? 'Spotify window 280 inspected' : 'window_id is not a live window' }],
        } });
      } else if (msg.params?.name === 'echo_test') {
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
      } else if (msg.params?.name === 'screenshot_test') {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            content: [
              {
                type: 'image',
                data: screenshotData,
                mimeType: 'image/png',
              },
              {
                type: 'text',
                text: 'desktop screenshot 1x1 px (screen 1x1 pts @ 1x)',
              },
            ],
            structuredContent: {
              display: 'primary',
              platform: 'macos',
              scale_factor: 1,
              screen_height: 1,
              screen_width: 1,
              screenshot_height: 1,
              screenshot_mime_type: 'image/png',
              screenshot_width: 1,
            },
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
