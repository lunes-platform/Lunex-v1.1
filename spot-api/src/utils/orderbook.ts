/**
 * In-memory Orderbook using sorted arrays with Price-Time Priority.
 * Bids sorted descending (highest first), Asks sorted ascending (lowest first).
 */

export interface OrderbookEntry {
  orderId: string;
  price: number;
  amount: number;
  remainingAmount: number;
  makerAddress: string;
  timestamp: number;
}

export interface OrderbookSnapshot {
  bids: Array<{ price: number; amount: number; total: number }>;
  asks: Array<{ price: number; amount: number; total: number }>;
}

export interface MatchResult {
  makerOrderId: string;
  takerOrderId: string;
  fillAmount: number;
  fillPrice: number;
  makerAddress: string;
  takerAddress: string;
}

export class Orderbook {
  private bids: OrderbookEntry[] = [];
  private asks: OrderbookEntry[] = [];
  private lastUpdatedAt: number | null = null;
  public readonly symbol: string;

  constructor(symbol: string) {
    this.symbol = symbol;
  }

  restoreLimitOrder(
    orderId: string,
    side: 'BUY' | 'SELL',
    price: number,
    amount: number,
    remainingAmount: number,
    makerAddress: string,
    timestamp: number,
  ) {
    const entry: OrderbookEntry = {
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
  addLimitOrder(
    orderId: string,
    side: 'BUY' | 'SELL',
    price: number,
    amount: number,
    makerAddress: string,
  ): MatchResult[] {
    const matches: MatchResult[] = [];
    let remaining = amount;
    const now = Date.now();
    let touched = false;

    if (side === 'BUY') {
      // Match against asks (lowest first)
      while (remaining > 0 && this.asks.length > 0) {
        const bestAsk = this.asks[0];
        if (price < bestAsk.price) break; // No more matches

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
    } else {
      // SELL: Match against bids (highest first)
      while (remaining > 0 && this.bids.length > 0) {
        const bestBid = this.bids[0];
        if (price > bestBid.price) break;

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
  addMarketOrder(
    orderId: string,
    side: 'BUY' | 'SELL',
    amount: number,
    makerAddress: string,
  ): MatchResult[] {
    const matches: MatchResult[] = [];
    let remaining = amount;
    const now = Date.now();
    let touched = false;

    if (side === 'BUY') {
      while (remaining > 0 && this.asks.length > 0) {
        const bestAsk = this.asks[0];
        // Self-trade prevention
        if (bestAsk.makerAddress === makerAddress) break;
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
    } else {
      while (remaining > 0 && this.bids.length > 0) {
        const bestBid = this.bids[0];
        // Self-trade prevention
        if (bestBid.makerAddress === makerAddress) break;
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
  cancelOrder(orderId: string): boolean {
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
  getSnapshot(depth: number = 25): OrderbookSnapshot {
    const aggregateLevels = (
      entries: OrderbookEntry[],
      maxLevels: number,
    ): Array<{ price: number; amount: number; total: number }> => {
      const levels = new Map<number, number>();

      for (const entry of entries) {
        const existing = levels.get(entry.price) || 0;
        levels.set(entry.price, existing + entry.remainingAmount);
      }

      const result: Array<{ price: number; amount: number; total: number }> =
        [];
      let cumulative = 0;
      for (const [price, amount] of levels) {
        cumulative += amount;
        result.push({ price, amount, total: cumulative });
        if (result.length >= maxLevels) break;
      }
      return result;
    };

    return {
      bids: aggregateLevels(this.bids, depth),
      asks: aggregateLevels(this.asks, depth),
    };
  }

  getBestBid(): number | null {
    return this.bids.length > 0 ? this.bids[0].price : null;
  }

  getBestAsk(): number | null {
    return this.asks.length > 0 ? this.asks[0].price : null;
  }

  getSpread(): number | null {
    const bid = this.getBestBid();
    const ask = this.getBestAsk();
    if (bid === null || ask === null) return null;
    return ask - bid;
  }

  getLastUpdatedAt(): number | null {
    return this.lastUpdatedAt;
  }

  getBidCount(): number {
    return this.bids.length;
  }

  getAskCount(): number {
    return this.asks.length;
  }

  // ─── Internal sorted insert ───

  private insertBid(entry: OrderbookEntry) {
    // Bids: sorted descending by price, then ascending by timestamp
    const idx = this.bids.findIndex(
      (b) =>
        entry.price > b.price ||
        (entry.price === b.price && entry.timestamp < b.timestamp),
    );
    if (idx === -1) {
      this.bids.push(entry);
    } else {
      this.bids.splice(idx, 0, entry);
    }
  }

  private insertAsk(entry: OrderbookEntry) {
    // Asks: sorted ascending by price, then ascending by timestamp
    const idx = this.asks.findIndex(
      (a) =>
        entry.price < a.price ||
        (entry.price === a.price && entry.timestamp < a.timestamp),
    );
    if (idx === -1) {
      this.asks.push(entry);
    } else {
      this.asks.splice(idx, 0, entry);
    }
  }

  private touch(timestamp: number) {
    this.lastUpdatedAt =
      this.lastUpdatedAt === null
        ? timestamp
        : Math.max(this.lastUpdatedAt, timestamp);
  }
}

/**
 * Manages orderbooks for all trading pairs.
 */
export class OrderbookManager {
  private books = new Map<string, Orderbook>();

  getOrCreate(symbol: string): Orderbook {
    let book = this.books.get(symbol);
    if (!book) {
      book = new Orderbook(symbol);
      this.books.set(symbol, book);
    }
    return book;
  }

  get(symbol: string): Orderbook | undefined {
    return this.books.get(symbol);
  }

  getAll(): Map<string, Orderbook> {
    return this.books;
  }

  clearAll() {
    this.books.clear();
  }
}

export const orderbookManager = new OrderbookManager();
