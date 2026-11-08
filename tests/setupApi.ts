import { ApiPromise, WsProvider, Keyring } from '@polkadot/api';

// Loaded via setupFilesAfterEnv so it runs in each test file's context:
// globals assigned in a jest globalSetup are only visible to globalTeardown.
beforeAll(async () => {
  const api = await ApiPromise.create({
    provider: new WsProvider(process.env.WS_URL ?? 'ws://127.0.0.1:9944'),
  });
  const keyring = new Keyring({ type: 'sr25519' });
  const alice = keyring.addFromUri('//Alice');
  const bob = keyring.addFromUri('//Bob');
  globalThis.setup = { api, alice, bob };
});

afterAll(async () => {
  await globalThis.setup?.api.disconnect();
});
