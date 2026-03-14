---
description: social analytics pipeline bootstrap, validation, and troubleshooting
---
1. Start the `spot-api` with the social analytics pipeline enabled.
   - Preferred local ports in this workspace are `4010` for HTTP and `4011` for WebSocket when `4000/4001` are occupied.
   - Example command:
     - `SOCIAL_ANALYTICS_ENABLED=true PORT=4010 WS_PORT=4011 npm run dev`

2. Confirm the API is healthy before checking analytics.
   - `curl -s http://127.0.0.1:4010/health`

3. Check pipeline status.
   - `curl -s http://127.0.0.1:4010/api/v1/social/analytics/status`
   - Validate these fields:
     - `enabled`
     - `cursor.status`
     - `cursor.lastProcessedBlock`
     - `indexedEvents`
     - `snapshots`
     - `latestIndexedEvent`

4. Trigger a manual recompute when needed.
   - `curl -s -X POST http://127.0.0.1:4010/api/v1/social/analytics/recompute`

5. Audit database state directly when status looks wrong.
   - Generate Prisma Client if needed:
     - `npm run db:generate`
   - Apply schema updates if needed:
     - `npm run db:migrate -- --name add_social_analytics_pipeline`
   - Inspect tables:
     - `SocialAnalyticsCursor`
     - `SocialIndexedEvent`
     - `LeaderAnalyticsSnapshot`

6. Troubleshoot common issues.
   - If `/social/analytics/status` returns `404`, use the correct prefix:
     - `/api/v1/social/analytics/status`
   - If the indexer reports `State already discarded` or `unknown Block`, the node is pruning old state.
     - The indexer now falls back to a recent window automatically.
     - If needed, reduce `SOCIAL_ANALYTICS_BACKFILL_BLOCKS`.
   - If `indexedEvents` stays `0` while the cursor advances, verify that:
     - contract addresses in `spot-api/deployed-addresses.json` match the active chain
     - the recent chain window actually contains tracked `ContractEmitted` events
     - leaders use real on-chain addresses instead of placeholder seed addresses

7. Rebuild after code changes.
   - `npm exec tsc --noEmit`

8. Keep only one local `spot-api` instance active while validating analytics.
   - Check listeners:
     - `lsof -nP -iTCP:4010 -iTCP:4011 -sTCP:LISTEN`
   - Stop duplicate `ts-node src/index.ts` processes before restarting.
