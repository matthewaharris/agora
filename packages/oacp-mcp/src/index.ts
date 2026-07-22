#!/usr/bin/env node
/**
 * OACP MCP Server — stdio entry point
 *
 * Usage (Claude Code):
 *   claude mcp add oacp -- npx -y oacp-mcp
 *
 * MCP speaks JSON-RPC over stdout, and the oacp-sdk logs with console.log —
 * so all console output is rerouted to stderr before any SDK code runs.
 */

console.log = (...args: unknown[]) => console.error(...args);
console.info = (...args: unknown[]) => console.error(...args);
console.warn = (...args: unknown[]) => console.error(...args);

async function main() {
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { buildServer } = await import('./server.js');

  const { server, shutdown } = buildServer();
  const transport = new StdioServerTransport();

  const exit = async (code: number) => {
    try {
      await shutdown();
    } finally {
      process.exit(code);
    }
  };

  process.on('SIGINT', () => void exit(0));
  process.on('SIGTERM', () => void exit(0));
  transport.onclose = () => void exit(0);

  await server.connect(transport);
  console.error('[oacp-mcp] Server running on stdio');
}

main().catch((err) => {
  console.error('[oacp-mcp] Fatal:', err);
  process.exit(1);
});
