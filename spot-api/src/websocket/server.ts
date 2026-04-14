import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { orderbookManager } from '../utils/orderbook';
import { wsConnections as wsConnectionsGauge } from '../utils/metrics';
import { log } from '../utils/logger';

// ─── Security Constants ──────────────────────────────────────────

const MAX_TOTAL_CLIENTS = 1000;
const MAX_CLIENTS_PER_IP = 20;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_MESSAGE_SIZE = 1024; // 1 KB max payload
const MAX_SUBSCRIPTIONS_PER_CLIENT = 50;
const PUBLIC_ORDERBOOK_DEPTH = 10; // unauthenticated depth
const AUTHENTICATED_ORDERBOOK_DEPTH = 25; // authenticated depth

/**
 * OWASP MCP7 — Channel whitelist prevents subscription to
 * arbitrary channels (e.g. user:VICTIM_ADDRESS espionage).
 */
const ALLOWED_CHANNEL_PREFIXES = ['orderbook:', 'trades:', 'ticker:'];

/**
 * OWASP MCP7 — Origin allowlist for CORS-like protection.
 * In production, populate from ALLOWED_WS_ORIGINS env var.
 */
function getAllowedOrigins(): string[] {
  const envOrigins = process.env.ALLOWED_WS_ORIGINS;
  if (envOrigins) return envOrigins.split(',').map((o) => o.trim());
  // Dev fallback — permissive
  return [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
  ];
}

function isOriginAllowed(origin: string | undefined): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  if (!origin) return false;
  return getAllowedOrigins().includes(origin);
}

function isChannelAllowed(channel: string): boolean {
  return ALLOWED_CHANNEL_PREFIXES.some((p) => channel.startsWith(p));
}

// ─── Client Interface ────────────────────────────────────────────

interface Client {
  ws: WebSocket;
  subscriptions: Set<string>;
  ip: string;
  lastSeen: number;
  authenticated: boolean;
}

const clients: Client[] = [];

function getIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

// ─── WebSocket Server ────────────────────────────────────────────

export function createWebSocketServer(port: number) {
  wsConnectionsGauge.set(0);

  const wss = new WebSocketServer({
    port,
    maxPayload: MAX_MESSAGE_SIZE, // OWASP MCP10 — Payload size limit
  });

  // Heartbeat to clean up stale connections
  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (let i = clients.length - 1; i >= 0; i--) {
      const client = clients[i];
      if (now - client.lastSeen > HEARTBEAT_INTERVAL_MS * 2) {
        client.ws.terminate();
        clients.splice(i, 1);
        wsConnectionsGauge.set(clients.length);
      } else if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.ping();
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const ip = getIp(req);
    const origin = req.headers.origin;

    // ── OWASP MCP7: Origin validation ──────────────────────────
    if (!isOriginAllowed(origin)) {
      ws.close(1008, 'Origin not allowed');
      log.warn({ ip, origin }, '[WS] Rejected: origin not in allowlist');
      return;
    }

    // ── Connection limit: global ───────────────────────────────
    if (clients.length >= MAX_TOTAL_CLIENTS) {
      ws.close(1013, 'Max connections reached');
      log.warn({ ip }, '[WS] Rejected: global limit reached');
      return;
    }

    // ── Connection limit: per-IP ───────────────────────────────
    const ipCount = clients.filter((c) => c.ip === ip).length;
    if (ipCount >= MAX_CLIENTS_PER_IP) {
      ws.close(1013, 'Too many connections from your IP');
      log.warn({ ip }, '[WS] Rejected: per-IP limit');
      return;
    }

    const client: Client = {
      ws,
      subscriptions: new Set(),
      ip,
      lastSeen: Date.now(),
      authenticated: false,
    };
    clients.push(client);
    wsConnectionsGauge.set(clients.length);

    // OWASP MCP8 — Audit: log new connection
    log.info(
      { ip, origin, totalClients: clients.length },
      '[WS] Client connected',
    );

    ws.on('pong', () => {
      client.lastSeen = Date.now();
    });

    ws.on('message', (data: Buffer) => {
      client.lastSeen = Date.now();

      // Message size already enforced by maxPayload, but double-check
      if (data.length > MAX_MESSAGE_SIZE) {
        ws.send(
          JSON.stringify({ type: 'error', message: 'Message too large' }),
        );
        return;
      }

      try {
        const msg = JSON.parse(data.toString());

        // ── Subscribe ─────────────────────────────────────────
        if (msg.action === 'subscribe' && typeof msg.channel === 'string') {
          // OWASP MCP7 — Channel whitelist
          if (!isChannelAllowed(msg.channel)) {
            ws.send(
              JSON.stringify({ type: 'error', message: 'Channel not allowed' }),
            );
            log.warn(
              { ip, channel: msg.channel },
              '[WS] Rejected subscription: channel not in whitelist',
            );
            return;
          }

          // Subscription limit per client
          if (client.subscriptions.size >= MAX_SUBSCRIPTIONS_PER_CLIENT) {
            ws.send(
              JSON.stringify({
                type: 'error',
                message: 'Subscription limit reached',
              }),
            );
            log.warn(
              { ip, count: client.subscriptions.size },
              '[WS] Rejected subscription: limit reached',
            );
            return;
          }

          client.subscriptions.add(msg.channel);
          ws.send(JSON.stringify({ type: 'subscribed', channel: msg.channel }));

          // OWASP MCP8 — Audit: log subscription
          log.info({ ip, channel: msg.channel }, '[WS] Subscribed');

          // Send initial snapshot for orderbook channels
          if (msg.channel.startsWith('orderbook:')) {
            const symbol = msg.channel.replace('orderbook:', '');
            const book = orderbookManager.get(symbol);
            if (book) {
              // OWASP MCP10 — Limit depth for unauthenticated clients
              const depth = client.authenticated
                ? AUTHENTICATED_ORDERBOOK_DEPTH
                : PUBLIC_ORDERBOOK_DEPTH;
              ws.send(
                JSON.stringify({
                  type: 'snapshot',
                  channel: msg.channel,
                  data: book.getSnapshot(depth),
                }),
              );
            }
          }
          return;
        }

        // ── Unsubscribe ───────────────────────────────────────
        if (msg.action === 'unsubscribe' && typeof msg.channel === 'string') {
          client.subscriptions.delete(msg.channel);
          ws.send(
            JSON.stringify({ type: 'unsubscribed', channel: msg.channel }),
          );
          log.info({ ip, channel: msg.channel }, '[WS] Unsubscribed');
          return;
        }

        // ── Ping ──────────────────────────────────────────────
        if (msg.action === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        // Unknown action
        ws.send(JSON.stringify({ type: 'error', message: 'Unknown action' }));
      } catch {
        ws.send(
          JSON.stringify({ type: 'error', message: 'Invalid message format' }),
        );
      }
    });

    ws.on('close', () => {
      const idx = clients.indexOf(client);
      if (idx >= 0) clients.splice(idx, 1);
      wsConnectionsGauge.set(clients.length);
      log.info(
        { ip, totalClients: clients.length },
        '[WS] Client disconnected',
      );
    });

    ws.send(
      JSON.stringify({ type: 'connected', message: 'Lunex Spot WebSocket' }),
    );
  });

  log.info(`WebSocket server running on ws://localhost:${port}`);
  return wss;
}
