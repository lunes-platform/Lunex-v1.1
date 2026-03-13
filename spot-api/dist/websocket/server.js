"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWebSocketServer = createWebSocketServer;
exports.broadcast = broadcast;
exports.broadcastOrderbookUpdate = broadcastOrderbookUpdate;
exports.broadcastTrade = broadcastTrade;
exports.broadcastTicker = broadcastTicker;
const ws_1 = require("ws");
const orderbook_1 = require("../utils/orderbook");
const logger_1 = require("../utils/logger");
const clients = [];
const MAX_TOTAL_CLIENTS = 1000;
const MAX_CLIENTS_PER_IP = 20;
const HEARTBEAT_INTERVAL_MS = 30000;
function getIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string')
        return forwarded.split(',')[0].trim();
    return req.socket.remoteAddress || 'unknown';
}
function createWebSocketServer(port) {
    const wss = new ws_1.WebSocketServer({ port });
    // Heartbeat to clean up stale connections
    const heartbeat = setInterval(() => {
        const now = Date.now();
        for (let i = clients.length - 1; i >= 0; i--) {
            const client = clients[i];
            if (now - client.lastSeen > HEARTBEAT_INTERVAL_MS * 2) {
                client.ws.terminate();
                clients.splice(i, 1);
            }
            else if (client.ws.readyState === ws_1.WebSocket.OPEN) {
                client.ws.ping();
            }
        }
    }, HEARTBEAT_INTERVAL_MS);
    wss.on('close', () => clearInterval(heartbeat));
    wss.on('connection', (ws, req) => {
        const ip = getIp(req);
        // Connection limit: global
        if (clients.length >= MAX_TOTAL_CLIENTS) {
            ws.close(1013, 'Max connections reached');
            logger_1.log.warn(`Rejected connection from ${ip}: global limit reached`);
            return;
        }
        // Connection limit: per-IP
        const ipCount = clients.filter(c => c.ip === ip).length;
        if (ipCount >= MAX_CLIENTS_PER_IP) {
            ws.close(1013, 'Too many connections from your IP');
            logger_1.log.warn(`Rejected connection from ${ip}: per-IP limit`);
            return;
        }
        const client = { ws, subscriptions: new Set(), ip, lastSeen: Date.now() };
        clients.push(client);
        ws.on('pong', () => { client.lastSeen = Date.now(); });
        ws.on('message', (data) => {
            client.lastSeen = Date.now();
            try {
                const msg = JSON.parse(data.toString());
                if (msg.action === 'subscribe' && msg.channel) {
                    client.subscriptions.add(msg.channel);
                    ws.send(JSON.stringify({ type: 'subscribed', channel: msg.channel }));
                    // Send initial snapshot for orderbook channels
                    if (msg.channel.startsWith('orderbook:')) {
                        const symbol = msg.channel.replace('orderbook:', '');
                        const book = orderbook_1.orderbookManager.get(symbol);
                        if (book) {
                            ws.send(JSON.stringify({
                                type: 'snapshot',
                                channel: msg.channel,
                                data: book.getSnapshot(25),
                            }));
                        }
                    }
                }
                if (msg.action === 'unsubscribe' && msg.channel) {
                    client.subscriptions.delete(msg.channel);
                    ws.send(JSON.stringify({ type: 'unsubscribed', channel: msg.channel }));
                }
                if (msg.action === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong' }));
                }
            }
            catch {
                ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
            }
        });
        ws.on('close', () => {
            const idx = clients.indexOf(client);
            if (idx >= 0)
                clients.splice(idx, 1);
        });
        ws.send(JSON.stringify({ type: 'connected', message: 'Lunex Spot WebSocket' }));
    });
    logger_1.log.info(`WebSocket server running on ws://localhost:${port}`);
    return wss;
}
/**
 * Broadcast a message to all clients subscribed to a channel
 */
function broadcast(channel, type, data) {
    const msg = JSON.stringify({ type, channel, data });
    for (const client of clients) {
        if (client.subscriptions.has(channel) && client.ws.readyState === ws_1.WebSocket.OPEN) {
            client.ws.send(msg);
        }
    }
}
/**
 * Broadcast orderbook update
 */
function broadcastOrderbookUpdate(symbol) {
    const book = orderbook_1.orderbookManager.get(symbol);
    if (!book)
        return;
    broadcast(`orderbook:${symbol}`, 'update', book.getSnapshot(25));
}
/**
 * Broadcast new trade
 */
function broadcastTrade(symbol, trade) {
    broadcast(`trades:${symbol}`, 'trade', trade);
}
/**
 * Broadcast ticker update
 */
function broadcastTicker(symbol, ticker) {
    broadcast(`ticker:${symbol}`, 'ticker', ticker);
}
//# sourceMappingURL=server.js.map