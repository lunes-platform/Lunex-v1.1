"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subqueryClient = void 0;
const config_1 = require("../config");
async function gql(query, variables) {
    const endpoint = config_1.config.subquery.endpoint;
    if (!endpoint)
        throw new Error('SUBQUERY_ENDPOINT not configured');
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
        throw new Error(`SubQuery GraphQL request failed: ${response.status} ${response.statusText}`);
    }
    const body = await response.json();
    if (body.errors?.length) {
        throw new Error(`SubQuery GraphQL errors: ${body.errors.map((e) => e.message).join(', ')}`);
    }
    return body.data;
}
exports.subqueryClient = {
    isEnabled() {
        return Boolean(config_1.config.subquery.endpoint);
    },
    // ── Indexer health/metadata ──────────────────────────────────
    async getMeta() {
        try {
            const data = await gql(`
        query {
          _metadata {
            lastProcessedHeight
            lastProcessedTimestamp
            targetHeight
            chain
            genesisHash
            indexerHealthy
            indexerNodeVersion
            queryNodeVersion
          }
        }
      `);
            return data._metadata;
        }
        catch {
            return null;
        }
    },
    // ── Swaps by wallet ──────────────────────────────────────────
    async getSwapsByAddress(address, limit = 500) {
        const data = await gql(`
      query GetSwaps($address: String!, $limit: Int!) {
        swapEvents(
          filter: { trader: { equalTo: $address } }
          orderBy: BLOCK_NUMBER_ASC
          first: $limit
        ) {
          nodes {
            id
            blockNumber
            timestamp
            extrinsicHash
            trader
            pairSymbol
            amountIn
            amountOut
            tokenIn
            tokenOut
          }
        }
      }
    `, { address, limit });
        return data.swapEvents.nodes;
    },
    // ── Vault events by leader/depositor ────────────────────────
    async getVaultEventsByAddress(address, limit = 500) {
        const data = await gql(`
      query GetVaultEvents($address: String!, $limit: Int!) {
        vaultEvents(
          filter: {
            or: [
              { actor: { equalTo: $address } }
              { leader: { equalTo: $address } }
            ]
          }
          orderBy: BLOCK_NUMBER_ASC
          first: $limit
        ) {
          nodes {
            id
            blockNumber
            timestamp
            kind
            actor
            leader
            amountIn
            amountOut
            equityAfter
            drawdownBps
            pairSymbol
          }
        }
      }
    `, { address, limit });
        return data.vaultEvents.nodes;
    },
    // ── Trade events by wallet ───────────────────────────────────
    async getTradeEventsByAddress(address, limit = 500) {
        const data = await gql(`
      query GetTrades($address: String!, $limit: Int!) {
        tradeEvents(
          filter: { trader: { equalTo: $address } }
          orderBy: BLOCK_NUMBER_ASC
          first: $limit
        ) {
          nodes {
            id
            blockNumber
            timestamp
            kind
            trader
            pairSymbol
            side
            realizedPnl
            size
          }
        }
      }
    `, { address, limit });
        return data.tradeEvents.nodes;
    },
    // ── All events by wallet (swaps + vault + trades) ────────────
    async getAllEventsByAddress(address, limit = 500) {
        const [swaps, vaultEvents, tradeEvents] = await Promise.all([
            this.getSwapsByAddress(address, limit),
            this.getVaultEventsByAddress(address, limit),
            this.getTradeEventsByAddress(address, limit),
        ]);
        return { swaps, vaultEvents, tradeEvents };
    },
    // ── Wallet summary (aggregated by SubQuery) ──────────────────
    async getWalletSummary(address) {
        const data = await gql(`
      query GetWalletSummary($id: String!) {
        walletSummary(id: $id) {
          id
          address
          totalSwapCount
          totalSwapVolumeIn
          totalSwapVolumeOut
          totalVaultDeposited
          totalVaultWithdrawn
          totalTradeCount
          totalRealizedPnl
          winningTrades
          losingTrades
          lastActivityAt
          firstActivityAt
        }
      }
    `, { id: address });
        return data.walletSummary;
    },
    // ── Pair stats ───────────────────────────────────────────────
    async getPairStats(pairSymbol) {
        const data = await gql(`
      query GetPairStats($id: String!) {
        pairStats(id: $id) {
          id
          pairSymbol
          swapCount
          volumeToken0
          volumeToken1
          lastSwapAt
        }
      }
    `, { id: pairSymbol });
        return data.pairStats;
    },
    // ── Daily stats ──────────────────────────────────────────────
    async getDailyStats(days = 30) {
        const data = await gql(`
      query GetDailyStats($limit: Int!) {
        dailyProtocolStats(
          orderBy: DATE_DESC
          first: $limit
        ) {
          nodes {
            id
            date
            swapCount
            swapVolumeUsd
            uniqueTraders
            liquidityEvents
            vaultDeposits
            vaultWithdrawals
          }
        }
      }
    `, { limit: days });
        return data.dailyProtocolStats.nodes;
    },
    // ── Latest block indexed ─────────────────────────────────────
    async getLatestIndexedBlock() {
        const meta = await this.getMeta();
        return meta?.lastProcessedHeight ?? 0;
    },
};
//# sourceMappingURL=subqueryClient.js.map