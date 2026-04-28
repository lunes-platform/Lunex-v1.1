#!/bin/sh
# ──────────────────────────────────────────────────────────────────────────────
# subquery-node entrypoint
#
# Renders project.template.yaml → project.yaml at startup, substituting
# environment variables. Required vars:
#   LUNES_CHAIN_ID    — genesis hash (e.g. mainnet hash)
#   LUNES_WS_URL      — WebSocket endpoint (e.g. wss://ws.lunes.io)
#   LUNES_START_BLOCK — block number to start indexing from (default: 1)
#
# This avoids hardcoding the devnet chainId in the committed project.yaml.
# ──────────────────────────────────────────────────────────────────────────────
set -e

TEMPLATE="/app/project.template.yaml"
OUTPUT="/app/project.yaml"

if [ ! -f "${TEMPLATE}" ]; then
  echo "[entrypoint] FATAL: ${TEMPLATE} not found" >&2
  exit 1
fi

if [ -z "${LUNES_CHAIN_ID}" ]; then
  echo "[entrypoint] FATAL: LUNES_CHAIN_ID is required" >&2
  echo "  Get it via: subkey inspect --network substrate <node-rpc-url>" >&2
  exit 1
fi

if [ -z "${LUNES_WS_URL}" ]; then
  echo "[entrypoint] FATAL: LUNES_WS_URL is required" >&2
  exit 1
fi

START_BLOCK="${LUNES_START_BLOCK:-1}"

echo "[entrypoint] Rendering ${TEMPLATE} → ${OUTPUT}"
echo "[entrypoint]   chainId=${LUNES_CHAIN_ID}"
echo "[entrypoint]   endpoint=${LUNES_WS_URL}"
echo "[entrypoint]   startBlock=${START_BLOCK}"

# sed escape for special chars in URLs and hashes
escape() { printf '%s' "$1" | sed -e 's/[\/&]/\\&/g'; }

CHAIN_ID_ESC=$(escape "${LUNES_CHAIN_ID}")
WS_URL_ESC=$(escape "${LUNES_WS_URL}")

sed \
  -e "s/__LUNES_CHAIN_ID__/${CHAIN_ID_ESC}/g" \
  -e "s/__LUNES_WS_URL__/${WS_URL_ESC}/g" \
  -e "s/__LUNES_START_BLOCK__/${START_BLOCK}/g" \
  "${TEMPLATE}" > "${OUTPUT}"

# Sanity check — placeholders must all be replaced
if grep -q '__LUNES_' "${OUTPUT}"; then
  echo "[entrypoint] FATAL: unsubstituted placeholders remain in ${OUTPUT}" >&2
  grep '__LUNES_' "${OUTPUT}" >&2
  exit 1
fi

echo "[entrypoint] Project config rendered. Starting subql-node..."
exec "$@"
