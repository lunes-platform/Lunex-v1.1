const ORIGINAL_ENV = process.env;

function loadCreateBridgeFromEnv() {
  jest.resetModules();
  return require('../services/assetBridgeService') as typeof import('../services/assetBridgeService');
}

describe('asset bridge startup guards', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.BRIDGE_ADMIN_SEED;
    delete process.env.LUNES_WS_URL;
    process.env.NODE_ENV = 'production';
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('rejects missing BRIDGE_ADMIN_SEED before signer creation', () => {
    const { createBridgeFromEnv } = loadCreateBridgeFromEnv();
    expect(() => createBridgeFromEnv()).toThrow(
      'BRIDGE_ADMIN_SEED is required for asset bridge startup',
    );
  });

  it('rejects development bridge admin seeds', () => {
    process.env.BRIDGE_ADMIN_SEED = '//Alice';
    const { createBridgeFromEnv } = loadCreateBridgeFromEnv();
    expect(() => createBridgeFromEnv()).toThrow(
      'BRIDGE_ADMIN_SEED must not use a development account for asset bridge startup',
    );
  });

  it('rejects placeholder bridge admin seeds', () => {
    process.env.BRIDGE_ADMIN_SEED = 'REPLACE_WITH_PRODUCTION_BRIDGE_ADMIN_SEED';
    const { createBridgeFromEnv } = loadCreateBridgeFromEnv();
    expect(() => createBridgeFromEnv()).toThrow(
      'BRIDGE_ADMIN_SEED still contains a placeholder value for asset bridge startup',
    );
  });

  it('rejects local LUNES_WS_URL in production', () => {
    process.env.BRIDGE_ADMIN_SEED = 'real bridge seed from secret manager';
    process.env.LUNES_WS_URL = 'ws://127.0.0.1:9944';
    const { createBridgeFromEnv } = loadCreateBridgeFromEnv();
    expect(() => createBridgeFromEnv()).toThrow(
      'LUNES_WS_URL must not point to localhost for asset bridge startup',
    );
  });
});
