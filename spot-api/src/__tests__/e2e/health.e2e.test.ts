import request from 'supertest';
import app from './testApp';

describe('Health Endpoint E2E', () => {
  it('GET /health should return status ok', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('marginPriceHealth');
    expect(res.body.marginPriceHealth).toHaveProperty('trackedPairs');
  });

  it('GET /metrics should expose Prometheus metrics', async () => {
    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('lunex_margin_mark_price_tracked_pairs');
  });
});
