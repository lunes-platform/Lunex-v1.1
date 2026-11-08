import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import request from 'supertest';
import {
  buildCorsOptions,
  buildHelmetOptions,
  createHttpsEnforcer,
} from '../../utils/httpSecurity';
import { responseSanitizer } from '../../middleware/responseSanitizer';

function appWith(isProd: boolean) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet(buildHelmetOptions(isProd)));
  app.use(
    cors(
      buildCorsOptions({
        isProd,
        allowedOrigins: ['https://app.lunex.io'],
      }),
    ),
  );
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('helmet / CORS (strict API headers)', () => {
  it('sends a deny-all CSP, no framing, nosniff, no-referrer, HSTS in prod', async () => {
    const res = await request(appWith(true)).get('/ping');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=31536000/);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('never combines a reflected origin with credentials', async () => {
    for (const isProd of [false, true]) {
      const res = await request(appWith(isProd))
        .get('/ping')
        .set('Origin', isProd ? 'https://app.lunex.io' : 'https://evil.example');
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    }
  });

  it('production rejects unknown origins', async () => {
    const app = appWith(true);
    app.use(
      (err: Error, _req: express.Request, res: express.Response, _n: express.NextFunction) => {
        void _n;
        res.status(403).json({ error: err.message });
      },
    );
    const res = await request(app).get('/ping').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('BE-22 — HTTPS redirect uses the canonical origin', () => {
  const app = express();
  app.use(createHttpsEnforcer('https://api.lunex.io'));
  app.all('*', (_req, res) => res.json({ ok: true }));

  it('ignores a spoofed Host header', async () => {
    const res = await request(app)
      .get('/api/v1/pairs?x=1')
      .set('Host', 'evil.com')
      .set('X-Forwarded-Proto', 'http');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('https://api.lunex.io/api/v1/pairs?x=1');
  });

  it('cannot be turned into a protocol-relative redirect', async () => {
    const res = await request(app)
      .get('//evil.com/x')
      .set('X-Forwarded-Proto', 'http');
    expect(res.headers.location ?? '').not.toContain('evil.com');
  });

  it('refuses non-GET over plain http and passes https through', async () => {
    expect(
      (await request(app).post('/api/v1/orders').set('X-Forwarded-Proto', 'http'))
        .status,
    ).toBe(400);
    expect(
      (await request(app).get('/x').set('X-Forwarded-Proto', 'https')).status,
    ).toBe(200);
  });

  it('without a configured origin it refuses instead of trusting Host', async () => {
    const bare = express();
    bare.use(createHttpsEnforcer(''));
    const res = await request(bare).get('/x').set('Host', 'evil.com');
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });
});

describe('BE-18 — sanitizer strips filesystem paths in production', () => {
  it('removes `path` from error bodies', async () => {
    const app = express();
    app.use(responseSanitizer({ isProduction: true }));
    app.get('/x', (_req, res) =>
      res.status(503).json({ error: 'unavailable', path: '/Users/x/target' }),
    );
    const res = await request(app).get('/x');
    expect(res.body).toEqual({ error: 'unavailable' });
  });
});
