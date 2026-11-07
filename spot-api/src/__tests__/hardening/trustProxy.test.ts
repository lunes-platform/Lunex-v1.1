import express from 'express';
import request from 'supertest';
import {
  parseTrustProxy,
  resolveClientIp,
  toExpressTrustProxy,
} from '../../utils/trustProxy';

describe('trust proxy (BE-09 / BE-16)', () => {
  it('parses hop counts, legacy true, CIDR lists and off values', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('0')).toBe(false);
    expect(parseTrustProxy('true')).toBe(1);
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('loopback, 10.0.0.0/8')).toEqual([
      'loopback',
      '10.0.0.0/8',
    ]);
    expect(() => parseTrustProxy('10.0.0.0/99')).toThrow(/TRUST_PROXY/);
    expect(() => parseTrustProxy('*')).toThrow(/TRUST_PROXY/);
  });

  it('ignores X-Forwarded-For entirely when no proxy is trusted', () => {
    expect(resolveClientIp('::ffff:127.0.0.1', '6.6.6.6', false)).toBe(
      '127.0.0.1',
    );
  });

  it('with N hops returns the N-th hop from the right, never a spoofed prefix', () => {
    // client prepends 6.6.6.6; nginx appends the real peer 203.0.113.7
    expect(resolveClientIp('10.0.0.2', '6.6.6.6, 203.0.113.7', 1)).toBe(
      '203.0.113.7',
    );
    // Cloudflare → nginx: two trusted hops
    expect(
      resolveClientIp('10.0.0.2', '6.6.6.6, 203.0.113.7, 172.68.1.1', 2),
    ).toBe('203.0.113.7');
    // no XFF: falls back to the socket peer
    expect(resolveClientIp('10.0.0.2', undefined, 1)).toBe('10.0.0.2');
  });

  it('with a CIDR list returns the right-most untrusted hop', () => {
    expect(
      resolveClientIp(
        '127.0.0.1',
        '6.6.6.6, 203.0.113.7, 10.1.2.3',
        ['loopback', '10.0.0.0/8'],
      ),
    ).toBe('203.0.113.7');
    // peer itself is not trusted → XFF is ignored
    expect(
      resolveClientIp('198.51.100.9', '6.6.6.6', ['10.0.0.0/8']),
    ).toBe('198.51.100.9');
  });

  it('Express req.ip uses the same semantics', async () => {
    const app = express();
    app.set('trust proxy', toExpressTrustProxy(['loopback']));
    app.get('/ip', (req, res) => res.json({ ip: req.ip }));
    const res = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', '6.6.6.6, 203.0.113.7');
    expect(res.body.ip).toBe('203.0.113.7');
  });
});
