import fs from 'node:fs';
import path from 'node:path';

/**
 * Build-time configuration written by `scripts/gen-runtime-config.mjs`
 * into `dist/runtime-config.json`. It mirrors the REACT_APP_* values the
 * web bundle was built with so the main process can derive a CSP that
 * matches exactly the endpoints the renderer is allowed to talk to.
 */
export type RuntimeConfig = {
  spotApiUrl: string;
  spotWsUrl: string;
  rpcEndpoints: string[];
  extraConnectSrc: string[];
  /** True only when the macOS build was code-signed (Squirrel.Mac requires it). */
  macSigned: boolean;
};

export const APP_SCHEME = 'app';
export const APP_HOST = 'lunex';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

export const UPDATE_OWNER = 'lunes-platform';
export const UPDATE_REPO = 'lunex-v1.1';
export const UPDATE_TAG_PREFIX = 'desktop-v';

const DEFAULT_CONFIG: RuntimeConfig = {
  spotApiUrl: 'http://localhost:4000',
  spotWsUrl: 'ws://localhost:4001',
  rpcEndpoints: ['wss://ws-test.lunes.io', 'wss://ws.lunes.io'],
  extraConnectSrc: [],
  macSigned: false,
};

const WALLETCONNECT_CONNECT_SRC = [
  'wss://relay.walletconnect.com',
  'wss://relay.walletconnect.org',
  'https://*.walletconnect.com',
  'https://*.walletconnect.org',
];

const WALLETCONNECT_FRAME_SRC = [
  'https://verify.walletconnect.com',
  'https://verify.walletconnect.org',
];

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export function loadRuntimeConfig(distDir: string): RuntimeConfig {
  const file = path.join(distDir, 'runtime-config.json');
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof raw !== 'object' || raw === null) return DEFAULT_CONFIG;
    const r = raw as Record<string, unknown>;
    return {
      spotApiUrl:
        typeof r.spotApiUrl === 'string' ? r.spotApiUrl : DEFAULT_CONFIG.spotApiUrl,
      spotWsUrl:
        typeof r.spotWsUrl === 'string' ? r.spotWsUrl : DEFAULT_CONFIG.spotWsUrl,
      rpcEndpoints: isStringArray(r.rpcEndpoints)
        ? r.rpcEndpoints
        : DEFAULT_CONFIG.rpcEndpoints,
      extraConnectSrc: isStringArray(r.extraConnectSrc) ? r.extraConnectSrc : [],
      macSigned: r.macSigned === true,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Converts an endpoint URL into a CSP source expression (scheme + host +
 * port). Only https/wss are accepted, plus http/ws for loopback hosts
 * (local development builds). Anything else is dropped.
 */
export function toCspSource(value: string): string | null {
  // Allow wildcard host sources such as https://*.example.com verbatim.
  if (/^(https|wss):\/\/\*\.[a-z0-9.-]+$/i.test(value)) return value.toLowerCase();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const secure = url.protocol === 'https:' || url.protocol === 'wss:';
  const loopback =
    (url.protocol === 'http:' || url.protocol === 'ws:') &&
    LOCAL_HOSTS.has(url.hostname);
  if (!secure && !loopback) return null;
  if (url.username || url.password) return null;
  return `${url.protocol}//${url.host}`;
}

function unique(values: Array<string | null>): string[] {
  return [...new Set(values.filter((v): v is string => v !== null))];
}

export function buildCsp(config: RuntimeConfig): string {
  const connect = unique([
    "'self'",
    toCspSource(config.spotApiUrl),
    toCspSource(config.spotWsUrl),
    ...config.rpcEndpoints.map(toCspSource),
    ...WALLETCONNECT_CONNECT_SRC,
    ...config.extraConnectSrc.map(toCspSource),
  ]);
  const apiOrigin = toCspSource(config.spotApiUrl);

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // 'wasm-unsafe-eval' is required by @polkadot/wasm-crypto (sr25519).
    // No 'unsafe-eval' and no inline scripts.
    'script-src': ["'self'", "'wasm-unsafe-eval'"],
    // styled-components injects <style> tags at runtime.
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
    // Token logos may be served by spot-api or third-party https hosts.
    'img-src': unique(["'self'", 'data:', 'blob:', 'https:', apiOrigin]),
    'connect-src': connect,
    'worker-src': ["'self'", 'blob:'],
    'frame-src': WALLETCONNECT_FRAME_SRC,
    'media-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'none'"],
    'frame-ancestors': ["'none'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');
}
