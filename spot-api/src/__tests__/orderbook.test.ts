import { Orderbook, OrderbookManager } from '../utils/orderbook';

describe('Orderbook', () => {
  let book: Orderbook;

  beforeEach(() => {
    book = new Orderbook('LUNES/USDT');
  });

  describe('Limit Orders - No Match', () => {
    it('should add a buy order to bids', () => {
      const matches = book.addLimitOrder('o1', 'BUY', 100, 10, 'alice');
      expect(matches).toHaveLength(0);
      expect(book.getBidCount()).toBe(1);
      expect(book.getBestBid()).toBe(100);
    });

    it('should add a sell order to asks', () => {
      const matches = book.addLimitOrder('o1', 'SELL', 200, 10, 'alice');
      expect(matches).toHaveLength(0);
      expect(book.getAskCount()).toBe(1);
      expect(book.getBestAsk()).toBe(200);
    });

    it('should sort bids descending by price', () => {
      book.addLimitOrder('o1', 'BUY', 100, 10, 'alice');
      book.addLimitOrder('o2', 'BUY', 150, 5, 'bob');
      book.addLimitOrder('o3', 'BUY', 120, 8, 'charlie');

      expect(book.getBestBid()).toBe(150);
    });

    it('should sort asks ascending by price', () => {
      book.addLimitOrder('o1', 'SELL', 200, 10, 'alice');
      book.addLimitOrder('o2', 'SELL', 180, 5, 'bob');
      book.addLimitOrder('o3', 'SELL', 190, 8, 'charlie');

      expect(book.getBestAsk()).toBe(180);
    });
  });

  describe('Limit Orders - Matching', () => {
    it('should match a buy order against existing asks', () => {
      // Place sell orders first
      book.addLimitOrder('s1', 'SELL', 100, 10, 'alice');
      book.addLimitOrder('s2', 'SELL', 105, 10, 'bob');

      // Place buy order at 100 - should match s1
      const matches = book.addLimitOrder('b1', 'BUY', 100, 5, 'charlie');

      expect(matches).toHaveLength(1);
      expect(matches[0].makerOrderId).toBe('s1');
      expect(matches[0].takerOrderId).toBe('b1');
      expect(matches[0].fillAmount).toBe(5);
      expect(matches[0].fillPrice).toBe(100); // Maker's price
    });

    it('should match across multiple price levels', () => {
      book.addLimitOrder('s1', 'SELL', 100, 5, 'alice');
      book.addLimitOrder('s2', 'SELL', 102, 5, 'bob');

      // Buy 8 at price 105 - should fill s1 fully (5) and s2 partially (3)
      const matches = book.addLimitOrder('b1', 'BUY', 105, 8, 'charlie');

      expect(matches).toHaveLength(2);
      expect(matches[0].fillAmount).toBe(5); // s1 fully filled
      expect(matches[0].fillPrice).toBe(100);
      expect(matches[1].fillAmount).toBe(3); // s2 partially filled
      expect(matches[1].fillPrice).toBe(102);
    });

    it('should add remainder to book after partial match', () => {
      book.addLimitOrder('s1', 'SELL', 100, 5, 'alice');

      // Buy 10 at 100, only 5 available
      const matches = book.addLimitOrder('b1', 'BUY', 100, 10, 'charlie');

      expect(matches).toHaveLength(1);
      expect(matches[0].fillAmount).toBe(5);
      // Remaining 5 should be in bids
      expect(book.getBidCount()).toBe(1);
      expect(book.getBestBid()).toBe(100);
    });

    it('should match a sell order against existing bids', () => {
      book.addLimitOrder('b1', 'BUY', 100, 10, 'alice');

      const matches = book.addLimitOrder('s1', 'SELL', 95, 5, 'bob');

      expect(matches).toHaveLength(1);
      expect(matches[0].makerOrderId).toBe('b1');
      expect(matches[0].takerOrderId).toBe('s1');
      expect(matches[0].fillAmount).toBe(5);
      expect(matches[0].fillPrice).toBe(100); // Maker's price (best bid)
    });

    it('should not match when prices do not cross', () => {
      book.addLimitOrder('s1', 'SELL', 110, 10, 'alice');

      const matches = book.addLimitOrder('b1', 'BUY', 105, 5, 'charlie');
      expect(matches).toHaveLength(0);
      expect(book.getBidCount()).toBe(1);
      expect(book.getAskCount()).toBe(1);
    });
  });

  describe('Market Orders', () => {
    it('should fill market buy against asks', () => {
      book.addLimitOrder('s1', 'SELL', 100, 10, 'alice');

      const matches = book.addMarketOrder('m1', 'BUY', 5, 'bob');

      expect(matches).toHaveLength(1);
      expect(matches[0].fillAmount).toBe(5);
      expect(matches[0].fillPrice).toBe(100);
    });

    it('should fill market sell against bids', () => {
      book.addLimitOrder('b1', 'BUY', 100, 10, 'alice');

      const matches = book.addMarketOrder('m1', 'SELL', 5, 'bob');

      expect(matches).toHaveLength(1);
      expect(matches[0].fillAmount).toBe(5);
      expect(matches[0].fillPrice).toBe(100);
    });

    it('should partially fill when insufficient liquidity', () => {
      book.addLimitOrder('s1', 'SELL', 100, 3, 'alice');

      const matches = book.addMarketOrder('m1', 'BUY', 10, 'bob');

      expect(matches).toHaveLength(1);
      expect(matches[0].fillAmount).toBe(3);
      // Remaining 7 stays in bids (market order becomes resting)
    });
  });

  describe('Cancel Order', () => {
    it('should cancel a bid', () => {
      book.addLimitOrder('o1', 'BUY', 100, 10, 'alice');
      expect(book.getBidCount()).toBe(1);

      const cancelled = book.cancelOrder('o1');
      expect(cancelled).toBe(true);
      expect(book.getBidCount()).toBe(0);
    });

    it('should cancel an ask', () => {
      book.addLimitOrder('o1', 'SELL', 100, 10, 'alice');
      expect(book.getAskCount()).toBe(1);

      const cancelled = book.cancelOrder('o1');
      expect(cancelled).toBe(true);
      expect(book.getAskCount()).toBe(0);
    });

    it('should return false for non-existent order', () => {
      const cancelled = book.cancelOrder('nonexistent');
      expect(cancelled).toBe(false);
    });
  });

  describe('Restore', () => {
    it('should restore resting orders without re-matching them', () => {
      book.restoreLimitOrder('b1', 'BUY', 100, 5, 3, 'alice', 1000);
      book.restoreLimitOrder('s1', 'SELL', 110, 4, 4, 'bob', 2000);

      const snapshot = book.getSnapshot();

      expect(snapshot.bids).toEqual([{ price: 100, amount: 3, total: 3 }]);
      expect(snapshot.asks).toEqual([{ price: 110, amount: 4, total: 4 }]);
    });

    it('should track lastUpdatedAt from restored orders', () => {
      book.restoreLimitOrder('b1', 'BUY', 100, 5, 3, 'alice', 1000);
      book.restoreLimitOrder('s1', 'SELL', 110, 4, 4, 'bob', 2000);

      expect(book.getLastUpdatedAt()).toBe(2000);
    });

    it('should restore a checkpoint after a failed match mutation', () => {
      book.addLimitOrder('s1', 'SELL', 100, 5, 'alice');
      const checkpoint = book.createCheckpoint();

      const matches = book.addMarketOrder('m1', 'BUY', 3, 'bob');
      expect(matches).toHaveLength(1);
      expect(book.getSnapshot().asks).toEqual([
        { price: 100, amount: 2, total: 2 },
      ]);

      book.restoreCheckpoint(checkpoint);

      expect(book.getSnapshot().asks).toEqual([
        { price: 100, amount: 5, total: 5 },
      ]);
    });
  });

  describe('Snapshot', () => {
    it('should return aggregated snapshot', () => {
      book.addLimitOrder('b1', 'BUY', 100, 5, 'alice');
      book.addLimitOrder('b2', 'BUY', 100, 3, 'bob');
      book.addLimitOrder('b3', 'BUY', 95, 10, 'charlie');

      book.addLimitOrder('s1', 'SELL', 110, 5, 'dave');
      book.addLimitOrder('s2', 'SELL', 115, 10, 'eve');

      const snapshot = book.getSnapshot();

      expect(snapshot.bids.length).toBe(2); // Two price levels
      expect(snapshot.bids[0].price).toBe(100);
      expect(snapshot.bids[0].amount).toBe(8); // 5 + 3 aggregated
      expect(snapshot.asks.length).toBe(2);
      expect(snapshot.asks[0].price).toBe(110);
    });

    it('should respect depth limit', () => {
      for (let i = 0; i < 50; i++) {
        book.addLimitOrder(`b${i}`, 'BUY', 100 - i, 1, `user${i}`);
      }

      const snapshot = book.getSnapshot(10);
      expect(snapshot.bids.length).toBe(10);
    });
  });

  describe('Spread', () => {
    it('should calculate spread', () => {
      book.addLimitOrder('b1', 'BUY', 100, 10, 'alice');
      book.addLimitOrder('s1', 'SELL', 105, 10, 'bob');

      expect(book.getSpread()).toBe(5);
    });

    it('should return null when no orders', () => {
      expect(book.getSpread()).toBeNull();
    });

    it('should update lastUpdatedAt when the book changes', () => {
      const before = Date.now();
      book.addLimitOrder('b1', 'BUY', 100, 10, 'alice');
      const afterAdd = book.getLastUpdatedAt();
      expect(afterAdd).not.toBeNull();
      expect(afterAdd!).toBeGreaterThanOrEqual(before);

      book.cancelOrder('b1');
      const afterCancel = book.getLastUpdatedAt();
      expect(afterCancel).not.toBeNull();
      expect(afterCancel!).toBeGreaterThanOrEqual(afterAdd!);
    });
  });

  describe('Price-Time Priority', () => {
    it('should match older orders first at same price', () => {
      // Two sells at same price, s1 placed first
      book.addLimitOrder('s1', 'SELL', 100, 5, 'alice');
      book.addLimitOrder('s2', 'SELL', 100, 5, 'bob');

      // Buy should match s1 first (time priority)
      const matches = book.addLimitOrder('b1', 'BUY', 100, 3, 'charlie');

      expect(matches).toHaveLength(1);
      expect(matches[0].makerOrderId).toBe('s1');
    });
  });
});

describe('OrderbookManager', () => {
  it('should create and return orderbooks', () => {
    const manager = new OrderbookManager();
    const book1 = manager.getOrCreate('LUNES/USDT');
    const book2 = manager.getOrCreate('LUNES/USDT');

    expect(book1).toBe(book2); // Same instance
    expect(book1.symbol).toBe('LUNES/USDT');
  });

  it('should return undefined for non-existent books', () => {
    const manager = new OrderbookManager();
    expect(manager.get('NONEXISTENT')).toBeUndefined();
  });

  it('should clear all managed books', () => {
    const manager = new OrderbookManager();
    manager.getOrCreate('LUNES/USDT');
    manager.getOrCreate('LUNES/BTC');

    manager.clearAll();

    expect(manager.getAll().size).toBe(0);
  });
});
