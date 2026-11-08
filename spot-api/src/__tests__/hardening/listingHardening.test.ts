/**
 * BE-14 / BE-19 / BE-23 — listing route hardening.
 */
jest.mock('../../services/listingService', () => ({
  getAllTierConfigs: jest.fn(),
  createListing: jest.fn(async (input: Record<string, unknown>) => ({
    id: 'listing-1',
    ...input,
  })),
  activateListing: jest.fn(),
  rejectListing: jest.fn(),
  getListingById: jest.fn(),
  getListingByToken: jest.fn(),
  getListings: jest.fn(async () => []),
  getOwnerListings: jest.fn(),
  withdrawLock: jest.fn(),
  finalizeWithdrawLockByOnChainId: jest.fn(),
  getListingStats: jest.fn(),
  processExpiredLocks: jest.fn(),
  TIER_CONFIG: { BASIC: {}, VERIFIED: {}, FEATURED: {} },
}));

jest.mock('../../middleware/auth', () => ({
  ...jest.requireActual('../../middleware/auth'),
  verifyWalletActionSignature: jest.fn(),
}));

import fs from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';
import listingRouter from '../../routes/listing';
import { getListings } from '../../services/listingService';
import { verifyWalletActionSignature } from '../../middleware/auth';

const verifyMock = verifyWalletActionSignature as jest.MockedFunction<
  typeof verifyWalletActionSignature
>;
const TOKENS_DIR = path.join(__dirname, '..', '..', '..', 'public', 'tokens');

const app = express();
app.use(express.json());
app.use('/api/v1/listing', listingRouter);

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
]);

const FIELDS = {
  ownerAddress: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
  tokenAddress: '5TokenAddressXYZ',
  tokenName: 'Token',
  tokenSymbol: 'TKN',
  tier: 'BASIC',
  lunesLiquidity: '100',
  tokenLiquidity: '100',
  nonce: 'nonce-12345678',
  timestamp: String(Date.now()),
  signature: 'signature-123',
};

function listTokens() {
  return new Set(fs.existsSync(TOKENS_DIR) ? fs.readdirSync(TOKENS_DIR) : []);
}

function multipart(fields: Record<string, string>) {
  let req = request(app).post('/api/v1/listing');
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req;
}

describe('BE-19 — GET /listing query validation', () => {
  it('rejects Prisma operator objects in status/tier', async () => {
    const res = await request(app).get('/api/v1/listing?status[not]=ACTIVE');
    expect(res.status).toBe(400);
    expect(getListings).not.toHaveBeenCalled();
  });

  it('rejects non-numeric limit with 400 instead of a Prisma 500', async () => {
    const res = await request(app).get('/api/v1/listing?limit=abc');
    expect(res.status).toBe(400);
  });

  it('accepts valid filters', async () => {
    const res = await request(app).get(
      '/api/v1/listing?status=ACTIVE&tier=BASIC&limit=10',
    );
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(10);
  });
});

describe('BE-14 — website must be https', () => {
  it('rejects javascript: website', async () => {
    verifyMock.mockResolvedValue({ ok: true, message: 'm' });
    const res = await request(app)
      .post('/api/v1/listing')
      .send({ ...FIELDS, website: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
  });
});

describe('BE-23 — logo upload', () => {
  it('writes nothing to disk when the signature is invalid', async () => {
    verifyMock.mockResolvedValue({ ok: false, error: 'Invalid signature' });
    const before = listTokens();
    const res = await multipart(FIELDS).attach('logo', PNG, {
      filename: '../../evil.png',
      contentType: 'image/png',
    });
    expect(res.status).toBe(401);
    expect(listTokens()).toEqual(before);
  });

  it('rejects multipart bodies with too many fields (4xx, not 500)', async () => {
    const many: Record<string, string> = { ...FIELDS };
    for (let i = 0; i < 100; i++) many[`f${i}`] = 'x';
    const res = await multipart(many);
    expect([400, 413]).toContain(res.status);
  });

  it('rejects a mimetype/content mismatch', async () => {
    verifyMock.mockResolvedValue({ ok: true, message: 'm' });
    const res = await multipart(FIELDS).attach(
      'logo',
      Buffer.from('<svg onload=alert(1)>'),
      { filename: 'x.png', contentType: 'image/png' },
    );
    expect(res.status).toBe(400);
  });

  it('persists a verified logo under a random name after auth', async () => {
    verifyMock.mockResolvedValue({ ok: true, message: 'm' });
    const before = listTokens();
    const res = await multipart(FIELDS).attach('logo', PNG, {
      filename: '../../evil.png',
      contentType: 'image/png',
    });
    expect(res.status).toBe(201);
    const logoURI: string = res.body.listing.logoURI;
    expect(logoURI).toMatch(/^\/tokens\/[0-9a-f]{32}\.png$/);
    const added = [...listTokens()].filter((f) => !before.has(f));
    expect(added).toEqual([path.basename(logoURI)]);
    fs.unlinkSync(path.join(TOKENS_DIR, added[0]));
  });
});
