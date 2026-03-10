"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWebSocketServer = createWebSocketServer;
exports.broadcast = broadcast;
exports.broadcastOrderbookUpdate = broadcastOrderbookUpdate;
exports.broadcastTrade = broadcastTrade;
exports.broadcastTicker = broadcastTicker;
const ws_1 = require("ws");
const orderbook_1 = require("../utils/orderbook");
const clients = [];
function createWebSocketServer(port) {
    const wss = new ws_1.WebSocketServer({ port });
    wss.on('connection', (ws) => {
        const client = { ws, subscriptions: new Set() };
        clients.push(client);
        ws.on('message', (data) => {
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
    console.log(`WebSocket server running on ws://localhost:${port}`);
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