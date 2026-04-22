// ─────────────────────────────────────────────────────────────────────────────
// Protocol-level integration test for the MCP server.
//
// Exercises tools/list against the in-process server and verifies that every
// tool is correctly advertised with inputSchema, outputSchema, and _meta —
// the three things Context's marketplace validator checks before accepting.
// ─────────────────────────────────────────────────────────────────────────────

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createServer, TOOL_DEFINITIONS } from '../src/server';

describe('MCP server', () => {
  it('advertises every tool with inputSchema, outputSchema, and _meta', async () => {
    const server = createServer();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    const client = new Client(
      { name: 'skypulse-test', version: '1.0.0' },
      { capabilities: {} }
    );

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const res = await client.listTools();
    expect(res.tools).toHaveLength(TOOL_DEFINITIONS.length);
    for (const tool of res.tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect((tool as unknown as { outputSchema?: unknown }).outputSchema).toBeDefined();
      expect((tool as unknown as { _meta?: Record<string, unknown> })._meta).toBeDefined();
      expect((tool as unknown as { _meta?: Record<string, unknown> })._meta?.queryEligible).toBe(true);
    }

    await client.close();
    await server.close();
  });
});
