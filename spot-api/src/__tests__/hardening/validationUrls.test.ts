import { UpsertLeaderProfileSchema } from '../../utils/validation';

const base = {
  address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
  name: 'Leader',
  username: 'leader_1',
  bio: 'bio',
  fee: 10,
  nonce: 'nonce-123456',
  timestamp: Date.now(),
  signature: 'signature-123',
};

describe('BE-14 — only https links are stored', () => {
  it.each([
    'javascript:alert(document.cookie)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'http://twitter.com/x',
    'https://user:pass@evil.example',
  ])('rejects %p in social links', (url) => {
    for (const field of ['twitterUrl', 'telegramUrl', 'discordUrl']) {
      expect(
        UpsertLeaderProfileSchema.safeParse({ ...base, [field]: url }).success,
      ).toBe(false);
    }
  });

  it('accepts https links and empty strings', () => {
    const parsed = UpsertLeaderProfileSchema.safeParse({
      ...base,
      twitterUrl: 'https://x.com/lunex',
      telegramUrl: '',
    });
    expect(parsed.success).toBe(true);
  });

  it('avatar accepts https or small png/jpeg/webp data URIs only', () => {
    const ok = (avatar: string) =>
      UpsertLeaderProfileSchema.safeParse({ ...base, avatar }).success;
    expect(ok('https://cdn.lunex.io/a.png')).toBe(true);
    expect(ok('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(ok('')).toBe(true);
    expect(ok('javascript:alert(1)')).toBe(false);
    expect(ok('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(ok(`data:image/png;base64,${'A'.repeat(100_000)}`)).toBe(false);
    expect(ok('just text')).toBe(false);
  });
});
