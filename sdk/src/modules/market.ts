import { HttpClient } from '../http-client';
import {
  MarginPriceHealthSnapshot,
  SpotApiHealth,
  SpotCandle,
  SpotOrderbookSnapshot,
  SpotPair,
  SpotTicker,
  SpotTrade,
} from '../spot-types';

export class MarketModule {
  constructor(private http: HttpClient) {}

  async getHealth(): Promise<SpotApiHealth> {
    return this.http.get('/health');
  }

  async getMetrics(): Promise<string> {
    return this.http.get('/metrics');
  }

  async getMarginPriceHealth(
    pairSymbol?: string,
  ): Promise<MarginPriceHealthSnapshot> {
    return this.http.get(
      '/api/v1/margin/price-health',
      pairSymbol ? { pairSymbol } : undefined,
    );
  }

  async resetMarginPriceHealth(
    pairSymbol?: string,
  ): Promise<MarginPriceHealthSnapshot> {
    return this.http.post(
      '/api/v1/margin/price-health/reset',
      pairSymbol ? { pairSymbol } : {},
    );
  }

  async getPairs(): Promise<SpotPair[]> {
    const response = await this.http.get<{ pairs: SpotPair[] }>(
      '/api/v1/pairs',
    );
    return response.pairs;
  }

  async getTicker(symbol: string): Promise<SpotTicker> {
    return this.http.get(`/api/v1/pairs/${encodeURIComponent(symbol)}/ticker`);
  }

  async getOrderbook(
    symbol: string,
    params?: { depth?: number },
  ): Promise<SpotOrderbookSnapshot> {
    return this.http.get(
      `/api/v1/orderbook/${encodeURIComponent(symbol)}`,
      params,
    );
  }

  async getRecentTrades(symbol: string, limit = 50): Promise<SpotTrade[]> {
    const response = await this.http.get<{ trades: SpotTrade[] }>(
      `/api/v1/trades/${encodeURIComponent(symbol)}`,
      { limit },
    );
    return response.trades;
  }

  async getCandles(
    symbol: string,
    params?: { timeframe?: string; limit?: number },
  ): Promise<SpotCandle[]> {
    const response = await this.http.get<{ candles: SpotCandle[] }>(
      `/api/v1/candles/${encodeURIComponent(symbol)}`,
      params,
    );
    return response.candles;
  }
}
