import fs from 'node:fs/promises';
import path from 'node:path';
import { protocol } from 'electron';
import { APP_HOST, APP_SCHEME } from './config';

/**
 * Must run before `app.whenReady()`. `standard` gives the scheme a real
 * origin (`app://lunex`) so BrowserRouter, relative URLs, localStorage and
 * CORS behave like https; `secure` makes it a secure context (WebCrypto,
 * clipboard). `bypassCSP` is intentionally NOT granted.
 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Resolves a request pathname to a file strictly inside `root`.
 * Returns null on traversal attempts or malformed input.
 */
export function resolveInsideRoot(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const resolved = path.resolve(root, `.${path.posix.normalize(`/${decoded}`)}`);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) return null;
  return resolved;
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

function textResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

/**
 * Serves the static web build from `webRoot` on `app://lunex/`.
 * Unknown extension-less paths fall back to index.html (SPA routing).
 */
export function handleAppProtocol(webRoot: string, csp: string): void {
  const root = path.resolve(webRoot);
  const indexFile = path.join(root, 'index.html');

  protocol.handle(APP_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return textResponse(405, 'Method Not Allowed');
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return textResponse(400, 'Bad Request');
    }
    if (url.host !== APP_HOST) return textResponse(404, 'Not Found');

    const target = resolveInsideRoot(root, url.pathname);
    if (target === null) return textResponse(403, 'Forbidden');

    let file: string;
    if (target !== root && (await isFile(target))) {
      file = target;
    } else if (path.extname(target) === '' || target === root) {
      file = indexFile; // SPA fallback for BrowserRouter routes
    } else {
      return textResponse(404, 'Not Found');
    }

    const body = await fs.readFile(file);
    const ext = path.extname(file).toLowerCase();
    const headers: Record<string, string> = {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'cross-origin-opener-policy': 'same-origin',
      // Only Vite's content-hashed output under /assets/ is immutable.
      'cache-control': url.pathname.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    };
    if (ext === '.html') headers['content-security-policy'] = csp;
    return new Response(request.method === 'HEAD' ? null : body, {
      status: 200,
      headers,
    });
  });
}
