#!/usr/bin/env node
/**
 * CLI Reporter — starts a WebSocket server, receives test results from the
 * React Native harness app, and prints them to the terminal.
 */

import { WebSocketServer, type WebSocket } from 'ws';
import {
  formatSuiteStart,
  formatTestPass,
  formatTestFail,
  formatTestSkip,
  formatRunComplete,
} from './formatter';

const PORT = 7878;

const wss = new WebSocketServer({ port: PORT });

console.log(`\n🧪 RN Test CLI — waiting for connection on ws://localhost:${PORT}...\n`);

wss.on('connection', (socket: WebSocket) => {
  console.log('📱 Harness app connected. Running tests...\n');

  socket.on('message', (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());

      switch (msg.type) {
        case 'suite:start':
          console.log(formatSuiteStart(msg.name, msg.path));
          break;

        case 'test:pass':
          console.log(formatTestPass(msg.name, msg.path, msg.duration));
          break;

        case 'test:fail':
          console.log(formatTestFail(msg.name, msg.path, msg.duration, msg.error));
          break;

        case 'test:skip':
          console.log(formatTestSkip(msg.name, msg.path));
          break;

        case 'run:complete':
          console.log(formatRunComplete(msg));
          // Exit with code 1 if any test failed
          const exitCode = msg.failed > 0 ? 1 : 0;
          setTimeout(() => process.exit(exitCode), 500);
          break;

        case 'suite:end':
          // No output needed
          break;

        default:
          // Unknown message type — ignore
          break;
      }
    } catch (err) {
      console.error('Failed to parse message:', err);
    }
  });

  socket.on('close', () => {
    console.log('\n📱 Harness app disconnected.');
  });
});

wss.on('error', (err) => {
  console.error('WebSocket server error:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  wss.close();
  process.exit(0);
});
