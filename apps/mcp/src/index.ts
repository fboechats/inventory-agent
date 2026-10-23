import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.js';

try {
  serveStdio(() => createServer(), { onerror: error => console.error('Inventory MCP protocol error:', error) });
} catch (error) {
  console.error('Inventory MCP startup failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
