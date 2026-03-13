"use strict";
/**
 * In-memory Orderbook using sorted arrays with Price-Time Priority.
 * Bids sorted descending (highest first), Asks sorted ascending (lowest first).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderbookManager = exports.OrderbookManager = exports.Orderbook = void 0;
class Orderbook {
    constructor(symbol) {
        this.bids = [];
        this.asks = [];
        this.lastUpdatedAt = null;
        this.symbol = symbol;
    }
    restoreLimitOrder(orderId, side, price, amount, remainingAmount, makerAddress, timestamp) {
        const entry = {
            orderId,
            price,
            amount,
            remainingAmount,
            makerAddress,
            timestamp,
        };
        if (side === 'BUY') {
            this.insertBid(entry);
            this.touch(timestamp);
            return;
        }
        this.insertAsk(entry);
        this.touch(timestamp);
    }
    clear() {
        this.bids = [];
        this.asks = [];
        this.lastUpdatedAt = null;
    }
    /**
     * Add a LIMIT order to the book (after checking for matches).
     * Returns any immediate matches.
     */
    addLimitOrder(orderId, side, price, amount, makerAddress) {
        const matches = [];
        let remaining = amount;
        const now = Date.now();
        let touched = false;
        if (side === 'BUY') {
            // Match against asks (lowest first)
            while (remaining > 0 && this.asks.length > 0) {
                const bestAsk = this.asks[0];
                if (price < bestAsk.price)
                    break; // No more matches
                // Self-trade prevention: skip orders from same address
                if (bestAsk.makerAddress === makerAddress) {
                    break;
                }
                const fillAmount = Math.min(remaining, bestAsk.remainingAmount);
                const fillPrice = bestAsk.price; // Maker's price (price-time priority)
                matches.push({
                    makerOrderId: bestAsk.orderId,
                    takerOrderId: orderId,
                    fillAmount,
                    fillPrice,
                    makerAddress: bestAsk.makerAddress,
                    takerAddress: makerAddress,
                });
                touched = true;
                bestAsk.remainingAmount -= fillAmount;
                remaining -= fillAmount;
                if (bestAsk.remainingAmount <= 0) {
                    this.asks.shift();
                }
            }
            // If order not fully filled, add remainder to book
            if (remaining > 0) {
                this.insertBid({
                    orderId,
                    price,
                    amount,
                    remainingAmount: remaining,
                    makerAddress,
                    timestamp: now,
                });
                touched = true;
            }
        }
        else {
            // SELL: Match against bids (highest first)
            while (remaining > 0 && this.bids.length > 0) {
                const bestBid = this.bids[0];
                if (price > bestBid.price)
                    break;
                // Self-trade prevention: skip orders from same address
                if (bestBid.makerAddress === makerAddress) {
                    break;
                }
                const fillAmount = Math.min(remaining, bestBid.remainingAmount);
                const fillPrice = bestBid.price;
                matches.push({
                    makerOrderId: bestBid.orderId,
                    takerOrderId: orderId,
                    fillAmount,
                    fillPrice,
                    makerAddress: bestBid.makerAddress,
                    takerAddress: makerAddress,
                });
                touched = true;
                bestBid.remainingAmount -= fillAmount;
                remaining -= fillAmount;
                if (bestBid.remainingAmount <= 0) {
                    this.bids.shift();
                }
            }
            if (remaining > 0) {
                this.insertAsk({
                    orderId,
                    price,
                    amount,
                    remainingAmount: remaining,
                    makerAddress,
                    timestamp: now,
                });
                touched = true;
            }
        }
        if (touched) {
            this.touch(now);
        }
        return matches;
    }
    /**
     * Process a MARKET order (no price limit, fill whatever is available).
     */
    addMarketOrder(orderId, side, amount, makerAddress) {
        const matches = [];
        let remaining = amount;
        const now = Date.now();
        let touched = false;
        if (side === 'BUY') {
            while (remaining > 0 && this.asks.length > 0) {
                const bestAsk = this.asks[0];
                // Self-trade prevention
                if (bestAsk.makerAddress === makerAddress)
                    break;
                const fillAmount = Math.min(remaining, bestAsk.remainingAmount);
                const fillPrice = bestAsk.price;
                matches.push({
                    makerOrderId: bestAsk.orderId,
                    takerOrderId: orderId,
                    fillAmount,
                    fillPrice,
                    makerAddress: bestAsk.makerAddress,
                    takerAddress: makerAddress,
                });
                touched = true;
                bestAsk.remainingAmount -= fillAmount;
                remaining -= fillAmount;
                if (bestAsk.remainingAmount <= 0) {
                    this.asks.shift();
                }
            }
        }
        else {
            while (remaining > 0 && this.bids.length > 0) {
                const bestBid = this.bids[0];
                // Self-trade prevention
                if (bestBid.makerAddress === makerAddress)
                    break;
                const fillAmount = Math.min(remaining, bestBid.remainingAmount);
                const fillPrice = bestBid.price;
                matches.push({
                    makerOrderId: bestBid.orderId,
                    takerOrderId: orderId,
                    fillAmount,
                    fillPrice,
                    makerAddress: bestBid.makerAddress,
                    takerAddress: makerAddress,
                });
                touched = true;
                bestBid.remainingAmount -= fillAmount;
                remaining -= fillAmount;
                if (bestBid.remainingAmount <= 0) {
                    this.bids.shift();
                }
            }
        }
        if (touched) {
            this.touch(now);
        }
        return matches;
    }
    /**
     * Cancel an order by removing it from the book.
     */
    cancelOrder(orderId) {
        let idx = this.bids.findIndex((o) => o.orderId === orderId);
        if (idx >= 0) {
            this.bids.splice(idx, 1);
            this.touch(Date.now());
            return true;
        }
        idx = this.asks.findIndex((o) => o.orderId === orderId);
        if (idx >= 0) {
            this.asks.splice(idx, 1);
            this.touch(Date.now());
            return true;
        }
        return false;
    }
    /**
     * Get aggregated snapshot of the orderbook for API consumers.
     */
    getSnapshot(depth = 25) {
        const aggregateLevels = (entries, maxLevels) => {
            const levels = new Map();
            for (const entry of entries) {
                const existing = levels.get(entry.price) || 0;
                levels.set(entry.price, existing + entry.remainingAmount);
            }
            const result = [];
            let cumulative = 0;
            for (const [price, amount] of levels) {
                cumulative += amount;
                result.push({ price, amount, total: cumulative });
                if (result.length >= maxLevels)
                    break;
            }
            return result;
        };
        return {
            bids: aggregateLevels(this.bids, depth),
            asks: aggregateLevels(this.asks, depth),
        };
    }
    getBestBid() {
        return this.bids.length > 0 ? this.bids[0].price : null;
    }
    getBestAsk() {
        return this.asks.length > 0 ? this.asks[0].price : null;
    }
    getSpread() {
        const bid = this.getBestBid();
        const ask = this.getBestAsk();
        if (bid === null || ask === null)
            return null;
        return ask - bid;
    }
    getLastUpdatedAt() {
        return this.lastUpdatedAt;
    }
    getBidCount() {
        return this.bids.length;
    }
    getAskCount() {
        return this.asks.length;
    }
    // ─── Internal sorted insert ───
    insertBid(entry) {
        // Bids: sorted descending by price, then ascending by timestamp
        const idx = this.bids.findIndex((b) => entry.price > b.price || (entry.price === b.price && entry.timestamp < b.timestamp));
        if (idx === -1) {
            this.bids.push(entry);
        }
        else {
            this.bids.splice(idx, 0, entry);
        }
    }
    insertAsk(entry) {
        // Asks: sorted ascending by price, then ascending by timestamp
        const idx = this.asks.findIndex((a) => entry.price < a.price || (entry.price === a.price && entry.timestamp < a.timestamp));
        if (idx === -1) {
            this.asks.push(entry);
        }
        else {
            this.asks.splice(idx, 0, entry);
        }
    }
    touch(timestamp) {
        this.lastUpdatedAt = this.lastUpdatedAt === null ? timestamp : Math.max(this.lastUpdatedAt, timestamp);
    }
}
exports.Orderbook = Orderbook;
/**
 * Manages orderbooks for all trading pairs.
 */
class OrderbookManager {
    constructor() {
        this.books = new Map();
    }
    getOrCreate(symbol) {
        let book = this.books.get(symbol);
        if (!book) {
            book = new Orderbook(symbol);
            this.books.set(symbol, book);
        }
        return book;
    }
    get(symbol) {
        return this.books.get(symbol);
    }
    getAll() {
        return this.books;
    }
    clearAll() {
        this.books.clear();
    }
}
exports.OrderbookManager = OrderbookManager;
exports.orderbookManager = new OrderbookManager();
//# sourceMappingURL=orderbook.js.map