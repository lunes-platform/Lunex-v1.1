#!/usr/bin/env node
/**
 * Writes dist/runtime-config.json, read by the main process to build the
 * Content-Security-Policy. Values mirror the REACT_APP_* variables the web
 * bundle is built with (process.env first, then lunes-dex-main/.env* files
 * via Vite's own loadEnv when available), so the CSP allows exactly the
 * endpoints the renderer uses.
 *
 * Extra connect-src entries: LUNEX_CSP_EXTRA_CONNECT_SRC (comma-separated).
 * macOS signed flag (enables auto-install of updates): set automatically
 * when CSC_LINK is present, or force with LUNEX_MAC_SIGNED=true.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const webDir = path.resolve(desktopDir, '..', 'lunes-dex-main');

let fileEnv = {};
try {
  const req = createRequire(path.join(webDir, 'package.json'));
  const vite = await import(pathToFileURL(req.resolve('vite')).href);
  fileEnv = vite.loadEnv('production', webDir, 'REACT_APP_');
} catch {
  // lunes-dex-main deps not installed: rely on process.env only.
}
const get = (k, d = '') => process.env[k] || fileEnv[k] || d;
const csv = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);

const config = {
  spotApiUrl: get('REACT_APP_SPOT_API_URL', get('REACT_APP_API_URL', 'http://localhost:4000')),
  spotWsUrl: get('REACT_APP_SPOT_WS_URL', 'ws://localhost:4001'),
  rpcEndpoints: [
    get('REACT_APP_RPC_TESTNET', 'wss://ws-test.lunes.io'),
    get('REACT_APP_RPC_MAINNET', 'wss://ws.lunes.io'),
    // Fallback endpoints hard-coded in lunes-dex-main
    'wss://ws.lunes.io',
    'wss://ws-test.lunes.io',
    'wss://ws-lunes-main-01.lunes.io',
    'wss://ws-lunes-main-02.lunes.io',
    'wss://ws-archive.lunes.io',
  ].filter((v, i, a) => a.indexOf(v) === i),
  extraConnectSrc: csv(process.env.LUNEX_CSP_EXTRA_CONNECT_SRC || ''),
  macSigned: process.env.LUNEX_MAC_SIGNED === 'true' || Boolean(process.env.CSC_LINK),
};

const out = path.join(desktopDir, 'dist', 'runtime-config.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`);
console.log(`[runtime-config] wrote ${out}`);
for (const [k, v] of Object.entries(config)) console.log(`  ${k}: ${JSON.stringify(v)}`);
for (const u of [config.spotApiUrl, config.spotWsUrl]) {
  if (/^(http|ws):\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(u)) {
    console.warn(`[runtime-config] WARNING: ${u} is a localhost endpoint (development build).`);
  } else if (!/^(https|wss):\/\//.test(u)) {
    console.error(`[runtime-config] ERROR: ${u} must use https/wss; the CSP would block it.`);
    process.exit(1);
  }
}
