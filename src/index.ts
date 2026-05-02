import 'dotenv/config';
import express, { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createContextMiddleware } from '@ctxprotocol/sdk';

import { createServer } from './server';
import { logger } from './utils/logger';
import { startScheduler } from './cron/scheduler';

const PORT = Number(process.env.PORT ?? 3000);
const NODE_ENV = process.env.NODE_ENV ?? 'development';
// Tool URL used as JWT audience on Context Protocol. Set this to your
// public deployment URL (e.g. https://skypulse.up.railway.app/mcp) once deployed.
const TOOL_URL = process.env.TOOL_URL;
// Set SKIP_CTX_AUTH=true to bypass Context Protocol JWT verification. Use only
// for local smoke-testing / curl — NEVER enable in production. The flag is
// hard-gated to non-production NODE_ENV to prevent accidental prod bypass.
const SKIP_CTX_AUTH =
  process.env.SKIP_CTX_AUTH === 'true' && NODE_ENV !== 'production';

async function main(): Promise<void> {
  logger.info('Starting SkyPulse MCP server', {
    version: '1.0.0',
    nodeEnv: NODE_ENV,
    port: PORT,
    audience: TOOL_URL ?? '(unset — strict audience check disabled)',
    ctxAuth: SKIP_CTX_AUTH ? 'BYPASSED (dev only)' : 'enforced',
  });

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/', (_req, res) => {
    res.status(200).json({
      name: 'skypulse',
      version: '1.0.0',
      description:
        'Airline Route Change & Capacity Intelligence — Context Protocol MCP tool',
      endpoints: {
        mcp: '/mcp',
        health: '/health',
      },
      docs: 'https://docs.ctxprotocol.com',
    });
  });

  app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true, ts: new Date().toISOString() });
  });

  // Context Protocol middleware — REQUIRED for paid tools. Verifies the
  // Context platform JWT on tools/call; discovery methods pass through.
  // Gated by SKIP_CTX_AUTH so local `curl` smoke tests can hit /mcp directly.
  if (!SKIP_CTX_AUTH) {
    app.use(
      '/mcp',
      createContextMiddleware(TOOL_URL ? { audience: TOOL_URL } : undefined)
    );
  } else {
    logger.warn(
      'Context Protocol auth middleware BYPASSED — SKIP_CTX_AUTH=true. Do not use this in production.'
    );
  }

  // MCP Streamable HTTP in stateless mode. Per the SDK's guidance for
  // serverless/stateless deployments (Railway, Vercel, Cloudflare), we create
  // a fresh McpServer + StreamableHTTPServerTransport per request. This is
  // what makes the tool horizontally-scalable without any shared session
  // store and matches Context Protocol's request-per-request routing model.
  //
  // Cost: ~1-3ms of object construction per request. Benefit: no leaked
  // sessions, no concurrency races on shared transport state, clean shutdown
  // of per-request resources via the transport's built-in close() in finally.
  const handleMcpRequest = async (
    req: Request,
    res: Response,
    body?: unknown
  ): Promise<void> => {
    // Per-request timing so we can pinpoint any non-SQL latency on the
    // live HTTP endpoint. Each phase is logged with the elapsed_ms since
    // the request was received. Reviewer feedback flagged 50+ s response
    // times that don't reproduce in direct-DB benchmarks — these timings
    // tell us whether time is being spent in transport setup, handler
    // dispatch, or the response write.
    const reqStart = Date.now();
    const reqMethod =
      typeof body === 'object' && body !== null && 'method' in body
        ? String((body as { method: unknown }).method)
        : req.method;
    const toolName =
      typeof body === 'object' &&
      body !== null &&
      'params' in body &&
      typeof (body as { params: unknown }).params === 'object' &&
      (body as { params: { name?: unknown } }).params !== null
        ? String((body as { params: { name?: unknown } }).params.name ?? '')
        : '';

    const mcpServer = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const setupMs = Date.now() - reqStart;

    res.on('close', () => {
      transport.close().catch(() => undefined);
      mcpServer.close().catch(() => undefined);
      logger.info('mcp request closed', {
        method: reqMethod,
        tool: toolName || undefined,
        setup_ms: setupMs,
        total_ms: Date.now() - reqStart,
      });
    });
    try {
      await mcpServer.connect(transport);
      const connectMs = Date.now() - reqStart;
      await transport.handleRequest(req, res, body);
      const handleMs = Date.now() - reqStart;
      // Logged in addition to the on('close') line because some clients
      // (Context's gateway) may keep the connection open long after the
      // body has been written; this gives us the true server processing
      // time.
      logger.info('mcp request handled', {
        method: reqMethod,
        tool: toolName || undefined,
        setup_ms: setupMs,
        connect_ms: connectMs,
        handle_ms: handleMs,
      });
    } catch (err) {
      logger.error('mcp transport error', {
        method: reqMethod,
        tool: toolName || undefined,
        elapsed_ms: Date.now() - reqStart,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal transport error' },
          id: null,
        });
      }
    }
  };

  app.post('/mcp', (req: Request, res: Response) => {
    void handleMcpRequest(req, res, req.body);
  });

  app.get('/mcp', (req: Request, res: Response) => {
    void handleMcpRequest(req, res);
  });

  app.delete('/mcp', (req: Request, res: Response) => {
    void handleMcpRequest(req, res);
  });

  // 404 for anything else (keeps discovery scans honest)
  app.use((req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', path: req.path });
  });

  const httpServer = app.listen(PORT, () => {
    logger.info('HTTP server listening', { port: PORT, mcpPath: '/mcp' });
  });

  // Cron scheduler is opt-in. Enable on one Railway replica by setting
  // RUN_CRON=true. Leaving it off by default prevents duplicate ingestions
  // when scaling beyond 1 instance and keeps the test env clean.
  if (process.env.RUN_CRON === 'true') {
    startScheduler();
  } else {
    logger.info('Cron scheduler disabled (set RUN_CRON=true to enable)');
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    httpServer.close(() => {
      logger.info('HTTP server closed');
    });
    // Per-request McpServer instances are closed via res.on('close') in
    // handleMcpRequest, so nothing additional to tear down here.
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason: String(reason) });
  });
}

main().catch((err) => {
  logger.error('Fatal startup error', { error: String(err) });
  process.exit(1);
});
