# Runbook: WebSocket Stream Drop

## Alerts

- `WebSocketConnectionsDrop`

## Impact

Orderbook, ticker, trade stream, and user-channel updates may stop updating in the DEX UI.

## Triage

1. Confirm active connection count and API health.
2. Check WebSocket server logs for upgrade failures or origin rejections.
3. Confirm `ALLOWED_WS_ORIGINS` matches production frontend origins.
4. Check nginx/proxy upgrade headers.

## Mitigation

1. Restart API/WebSocket process if HTTP health is healthy but WS is stuck.
2. Roll back proxy or CORS/origin changes if they caused rejected upgrades.
3. Notify users if orderbook data may be stale.

## Evidence To Capture

- connection metric before/after
- origin and proxy config
- user-visible stale-data window

