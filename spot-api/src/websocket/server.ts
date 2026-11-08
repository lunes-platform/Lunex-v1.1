import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { orderbookManager } from '../utils/orderbook';
import { wsConnections as wsConnectionsGauge } from '../utils/metrics';
import { log } from '../utils/logger';
import { config } from '../config';
import { validateReadSessionToken } from '../middleware/readSession';
import { resolveClientIp } from '../utils/trustProxy';

// ─── Security Constants ──────────────────────────────────────────

const MAX_TOTAL_CLIENTS = 1000;
const MAX_CLIENTS_PER_IP = 20;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_MESSAGE_SIZE = 1024; // 1 KB max payload
const MAX_SUBSCRIPTIONS_PER_CLIENT = 50;
const PUBLIC_ORDERBOOK_DEPTH = 10; // unauthenticated depth
const AUTHENTICATED_ORDERBOOK_DEPTH = 25; // authenticated depth
// Per-connection message token bucket (BE-21): bursts of up to 30 messages,
// sustained 10 msg/s. Exceeding it closes the socket with 1008.
const DEFAULT_MESSAGE_BUCKET = { capacity: 30, refillPerSec: 10 };
// Periodic re-validation of read sessions bound to sockets (revocation).
const DEFAULT_SESSION_RECHECK_MS = 30_000;

export type WebSocketServerOptions = {
  messageBucket?: { capacity: number; refillPerSec: number };
  sessionRecheckMs?: number;
};

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
  return config.websocket.allowedOrigins;
}

function isOriginAllowed(origin: string | undefined): boolean {
  if (!config.isProd) return true;
  if (!origin) return false;
  return getAllowedOrigins().includes(origin);
}

/**
 * Private per-wallet channel (`user:<address>`): fill / order updates.
 * Only a client that authenticated with a valid read session for that exact
 * address may subscribe — prevents `user:VICTIM_ADDRESS` espionage.
 */
const USER_CHANNEL_PREFIX = 'user:';

function hasValidUserSession(client: Client, nowSec = Date.now() / 1000) {
  return (
    client.authenticated &&
    !!client.address &&
    (client.sessionExp ?? 0) > nowSec
  );
}

function isChannelAllowed(channel: string, client: Client): boolean {
  if (channel.startsWith(USER_CHANNEL_PREFIX)) {
    return (
      hasValidUserSession(client) &&
      channel === `${USER_CHANNEL_PREFIX}${client.address}`
    );
  }
  return ALLOWED_CHANNEL_PREFIXES.some((p) => channel.startsWith(p));
}

// ─── Client Interface ────────────────────────────────────────────

interface Client {
  ws: WebSocket;
  subscriptions: Set<string>;
  ip: string;
  lastSeen: number;
  authenticated: boolean;
  /** Wallet bound by a read-session token (action `auth`). */
  address?: string;
  /** Session expiry (unix seconds); private channels stop after it. */
  sessionExp?: number;
  /** Raw read-session token, kept to re-check revocation (BE-21). */
  sessionToken?: string;
  /** Serializes async user-channel sends so updates keep their order. */
  sendChain: Promise<void>;
  /** Message token bucket. */
  tokens: number;
  tokensUpdatedAt: number;
}

const clients: Client[] = [];

function sendUpdate(client: Client, channel: string, data: unknown) {
  if (
    !client.subscriptions.has(channel) ||
    client.ws.readyState !== WebSocket.OPEN
  )
    return;
  try {
    client.ws.send(JSON.stringify({ type: 'update', channel, data }));
  } catch (error) {
    log.warn({ err: error, channel }, '[WS] Failed to send committed update');
  }
}

export function broadcastOrderbook(symbol: string) {
  const book = orderbookManager.get(symbol);
  if (!book) return;
  for (const client of clients) {
    const depth = client.authenticated
      ? AUTHENTICATED_ORDERBOOK_DEPTH
      : PUBLIC_ORDERBOOK_DEPTH;
    sendUpdate(client, `orderbook:${symbol}`, book.getSnapshot(depth));
  }
}

export function broadcastTrade(symbol: string, trade: Record<string, unknown>) {
  const {
    id,
    side,
    price,
    amount,
    quoteAmount,
    makerFee,
    takerFee,
    settlementStatus,
    txHash,
    createdAt,
  } = trade;
  const data = {
    id,
    side,
    price,
    amount,
    quoteAmount,
    makerFee,
    takerFee,
    settlementStatus,
    txHash,
    createdAt,
  };
  for (const client of clients) sendUpdate(client, `trades:${symbol}`, data);
}

/**
 * Push an update to every client subscribed to `channel`. Private user
 * channels are re-checked against the session expiry on every send.
 */
export function broadcast(channel: string, data: unknown) {
  const isUser = channel.startsWith(USER_CHANNEL_PREFIX);
  const payload = JSON.stringify({ type: 'update', channel, data });
  const nowSec = Date.now() / 1000;
  for (const client of clients) {
    if (!client.subscriptions.has(channel)) continue;
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    if (isUser) {
      if (!hasValidUserSession(client, nowSec)) {
        client.subscriptions.delete(channel);
        continue;
      }
      // Private data: re-validate the session (revocation) at use time.
      client.sendChain = client.sendChain
        .then(async () => {
          if (!(await revalidateSession(client))) return;
          if (!client.subscriptions.has(channel)) return;
          if (client.ws.readyState !== WebSocket.OPEN) return;
          client.ws.send(payload);
        })
        .catch((err: unknown) => {
          log.warn({ err, channel }, '[WS] User broadcast failed');
        });
      continue;
    }
    try {
      client.ws.send(payload);
    } catch (err) {
      log.warn({ err, channel }, '[WS] Broadcast send failed');
    }
  }
}

function dropUserSession(client: Client, reason: string) {
  if (client.address) {
    client.subscriptions.delete(`${USER_CHANNEL_PREFIX}${client.address}`);
  }
  client.authenticated = false;
  client.address = undefined;
  client.sessionExp = undefined;
  client.sessionToken = undefined;
  if (client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify({ type: 'session_revoked', reason }));
  }
  log.info({ ip: client.ip, reason }, '[WS] Read session dropped');
}

/**
 * Re-checks signature/expiry/revocation of the session bound to a socket.
 * Fails closed: an unavailable revocation store drops the session.
 */
async function revalidateSession(client: Client): Promise<boolean> {
  if (!client.authenticated || !client.sessionToken) return false;
  let claims: Awaited<ReturnType<typeof validateReadSessionToken>> = null;
  try {
    claims = await validateReadSessionToken(client.sessionToken);
  } catch (err: unknown) {
    log.warn({ err, ip: client.ip }, '[WS] Session re-validation failed');
  }
  if (!claims || claims.sub !== client.address) {
    if (client.authenticated) dropUserSession(client, 'revoked_or_expired');
    return false;
  }
  return true;
}

/** Token bucket: true when the message may be processed. */
function takeMessageToken(
  client: Client,
  bucket: { capacity: number; refillPerSec: number },
  now = Date.now(),
): boolean {
  const elapsedSec = (now - client.tokensUpdatedAt) / 1000;
  client.tokens = Math.min(
    bucket.capacity,
    client.tokens + elapsedSec * bucket.refillPerSec,
  );
  client.tokensUpdatedAt = now;
  if (client.tokens < 1) return false;
  client.tokens -= 1;
  return true;
}

/**
 * Client IP for per-IP limits. X-Forwarded-For is honoured only through
 * trusted proxies (TRUST_PROXY, same semantics as Express `trust proxy`);
 * a client-supplied XFF can no longer pick its own IP (BE-09).
 */
function getIp(req: IncomingMessage): string {
  return resolveClientIp(
    req.socket.remoteAddress,
    req.headers['x-forwarded-for'],
    config.trustProxy,
  );
}

// ─── WebSocket Server ────────────────────────────────────────────

export function createWebSocketServer(
  port: number,
  options: WebSocketServerOptions = {},
) {
  wsConnectionsGauge.set(0);
  const messageBucket = options.messageBucket ?? DEFAULT_MESSAGE_BUCKET;
  const sessionRecheckMs =
    options.sessionRecheckMs ?? DEFAULT_SESSION_RECHECK_MS;

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

  // Periodic revocation sweep for sockets bound to a read session.
  const sessionSweep = setInterval(() => {
    for (const client of clients) {
      if (client.authenticated) void revalidateSession(client);
    }
  }, sessionRecheckMs);
  sessionSweep.unref();

  wss.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(sessionSweep);
  });

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
      sendChain: Promise.resolve(),
      tokens: messageBucket.capacity,
      tokensUpdatedAt: Date.now(),
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

      if (!takeMessageToken(client, messageBucket)) {
        log.warn({ ip }, '[WS] Closing client: message rate limit exceeded');
        ws.close(1008, 'Rate limit exceeded');
        return;
      }

      // Message size already enforced by maxPayload, but double-check
      if (data.length > MAX_MESSAGE_SIZE) {
        ws.send(
          JSON.stringify({ type: 'error', message: 'Message too large' }),
        );
        return;
      }

      try {
        const msg = JSON.parse(data.toString());

        // ── Auth (read session) ───────────────────────────────
        // Binds this connection to a wallet so it may subscribe to its own
        // `user:<address>` channel. Read-only: no action is authorized.
        if (msg.action === 'auth' && typeof msg.token === 'string') {
          validateReadSessionToken(msg.token)
            .then((claims) => {
              if (!claims) {
                ws.send(
                  JSON.stringify({
                    type: 'error',
                    message: 'Invalid or expired session',
                  }),
                );
                log.warn({ ip }, '[SECURITY] WS session auth rejected');
                return;
              }
              // Switching wallets drops the previous wallet's channel.
              if (client.address && client.address !== claims.sub) {
                client.subscriptions.delete(
                  `${USER_CHANNEL_PREFIX}${client.address}`,
                );
              }
              client.authenticated = true;
              client.address = claims.sub;
              client.sessionExp = claims.exp;
              client.sessionToken = msg.token;
              ws.send(
                JSON.stringify({ type: 'authenticated', address: claims.sub }),
              );
              log.info({ ip }, '[WS] Client authenticated with read session');
            })
            .catch((err: unknown) => {
              log.error({ err, ip }, '[WS] Session auth failed');
              ws.send(
                JSON.stringify({ type: 'error', message: 'Auth unavailable' }),
              );
            });
          return;
        }

        // ── Subscribe ─────────────────────────────────────────
        if (msg.action === 'subscribe' && typeof msg.channel === 'string') {
          // OWASP MCP7 — Channel whitelist
          if (!isChannelAllowed(msg.channel, client)) {
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
          log.debug({ ip, channel: msg.channel }, '[WS] Subscribed');

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
          log.debug({ ip, channel: msg.channel }, '[WS] Unsubscribed');
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
