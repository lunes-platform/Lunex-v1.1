// Local development only. Never print wallets.secrets or api.env.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { atomicJson, loadRun, localUrl, resumeSafety, alive } = require('./core.cjs');
const { connect } = require('./chain.cjs');
const root = path.resolve(__dirname, '../..');
const dir = process.argv[2];
assert(dir && path.isAbsolute(dir), 'absolute run directory required');
const phase = process.argv[3] || 'chain';
const dep = name => require(path.join(root, 'spot-api/node_modules', name));
const envFile = path.join(dir, 'api.env');
const writeEnv = env => { fs.writeFileSync(envFile, Object.entries(env).map(([k, v]) => k + '=' + JSON.stringify(String(v))).join('\n') + '\n', { mode: 0o600 }); fs.chmodSync(envFile, 0o600); };
const run = (cmd, args, options = {}) => { const p = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...options }); assert.equal(p.status, 0, cmd + ' failed'); };

(async () => {
  if (phase === 'prepare') {
    assert(!fs.existsSync(path.join(dir, 'manifest.json')), 'run already exists; do not overwrite its keys');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(dir, 0o700);
    await dep('@polkadot/util-crypto').cryptoWaitReady();
    const mnemonic = dep('@polkadot/util-crypto').mnemonicGenerate;
    const secrets = { traders: Array.from({ length: 4 }, () => mnemonic()), lp: mnemonic(), relayer: mnemonic(), treasury: mnemonic(), attestorSeed: crypto.randomBytes(32).toString('hex'), adminSecret: crypto.randomBytes(32).toString('hex') };
    atomicJson(path.join(dir, 'wallets.secrets'), secrets);
    const core = JSON.parse(fs.readFileSync(path.join(root, 'spot-api/deployed-addresses.json')));
    const manifest = { version: 1, id: path.basename(dir), sourceRoot: root, network: 'ws://127.0.0.1:9944', apiUrl: 'http://127.0.0.1:4200', wsUrl: 'ws://127.0.0.1:4201', frontUrl: 'http://127.0.0.1:3200', database: 'lunex_soak_20261018', redisDb: 10, factory: core.factory, router: core.router, wrapped: core.wnative, native: '0x' + '00'.repeat(32), symbol: 'SB46/SUSD46', minCycleMs: 60000, browserEveryMs: 900000, durationMs: 46 * 3600000, createdAt: new Date().toISOString() };
    atomicJson(path.join(dir, 'manifest.json'), manifest);
    fs.mkdirSync(path.join(dir, 'abis'));
    for (const name of ['spot_settlement_contract', 'psp22_token', 'pair_contract', 'factory_contract', 'router_contract', 'wnative_contract']) fs.copyFileSync(path.join(root, 'target/ink', name, name + '.contract'), path.join(dir, 'abis', name + '.contract'));
    const previous = dep('dotenv').parse(fs.readFileSync('/private/tmp/lunex-advanced-qa.env'));
    const db = localUrl(previous.DATABASE_URL); db.pathname = '/' + manifest.database;
    writeEnv({ DATABASE_URL: db.href, PORT: 4200, WS_PORT: 4201, NODE_ENV: 'development', LUNES_WS_URL: manifest.network, REDIS_URL: 'redis://127.0.0.1:6379/10', ADMIN_SECRET: secrets.adminSecret, RELAYER_SEED: secrets.relayer, ATTESTOR_SEED: secrets.attestorSeed, SETTLEMENT_ENABLED: 'true', SPOT_CONTRACT_METADATA_PATH: path.join(dir, 'abis/spot_settlement_contract.contract'), FACTORY_CONTRACT_ADDRESS: core.factory, FACTORY_CONTRACT_METADATA_PATH: path.join(dir, 'abis/factory_contract.contract'), NATIVE_TOKEN_ADDRESS: manifest.native, MAX_SETTLE_CONCURRENCY: 1, LOG_LEVEL: 'warn', CORS_ALLOWED_ORIGINS: manifest.frontUrl, ALLOWED_WS_ORIGINS: manifest.frontUrl, SOCIAL_ANALYTICS_ENABLED: 'false', COPYTRADE_WALLET_CONTINUATION_SCHEDULER_ENABLED: 'false', REWARDS_ENABLED: 'false' });
    console.log(JSON.stringify({ prepared: dir, wallets: 7, database: manifest.database })); return;
  }
  const ctx = loadRun(dir); const m = ctx.manifest;
  const env = dep('dotenv').parse(fs.readFileSync(envFile));
  if (phase === 'refresh-scripts') {
    const controlFile = path.join(dir, 'control.json'); assert(!fs.existsSync(controlFile) || !JSON.parse(fs.readFileSync(controlFile)).startedAt, 'snapshot already running');
    assert(resumeSafety(ctx.state) && !alive(ctx.state.pid), 'wait until the canary worker exits');
    fs.cpSync(path.join(root, 'scripts/soak'), path.join(dir, 'runtime/soak'), { recursive: true });
    const scripts = path.join(dir, 'runtime/soak');
    m.snapshot.scripts = Object.fromEntries(fs.readdirSync(scripts).filter(n => n.endsWith('.cjs')).map(n => [n, crypto.createHash('sha256').update(fs.readFileSync(path.join(scripts, n))).digest('hex')]));
    m.snapshot.scriptsUpdatedAt = new Date().toISOString(); atomicJson(path.join(dir, 'manifest.json'), m); console.log(JSON.stringify({ refreshedScripts: m.snapshot.scriptsUpdatedAt })); return;
  }
  if (phase === 'database') {
    assert(/^lunex_soak_[0-9]+$/.test(m.database));
    const db = localUrl(env.DATABASE_URL);
    const pgEnv = { ...process.env, PGHOST: db.hostname, PGPORT: db.port || '5432', PGUSER: decodeURIComponent(db.username), PGPASSWORD: decodeURIComponent(db.password), PGDATABASE: 'postgres' };
    const exists = spawnSync('psql', ['-X', '-tAc', `SELECT 1 FROM pg_database WHERE datname='${m.database}'`], { env: pgEnv, encoding: 'utf8' });
    assert.equal(exists.status, 0, 'PostgreSQL unavailable');
    if (exists.stdout.trim() !== '1') run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE ' + m.database], { env: pgEnv });
    run(process.execPath, [path.join(root, 'spot-api/node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { cwd: path.join(root, 'spot-api'), env: { ...process.env, ...env } }); return;
  }
  if (phase === 'register') {
    assert(m.ready, 'chain setup incomplete');
    const body = { symbol: m.symbol, baseToken: m.base, quoteToken: m.quote, baseName: 'SB46', quoteName: 'SUSD46', baseDecimals: 8, quoteDecimals: 6, isNativeBase: false, isNativeQuote: false, makerFeeBps: 10, takerFeeBps: 25 };
    const response = await fetch(m.apiUrl + '/api/v1/pairs/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ctx.secrets.adminSecret }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const data = await response.json(); assert([201, 409].includes(response.status), JSON.stringify(data));
    const catalogue = await (await fetch(m.apiUrl + '/api/v1/pairs')).json(); const pair = catalogue.pairs.find(p => p.symbol === m.symbol);
    assert(pair, 'registered pair missing'); assert.equal(pair.pairAddress, m.pair); assert.equal(pair.baseDecimals, 8); assert.equal(pair.quoteDecimals, 6);
    atomicJson(path.join(dir, 'pair-registration.json'), { at: new Date().toISOString(), status: response.status, pair }); console.log(JSON.stringify({ registered: pair.symbol, pairAddress: pair.pairAddress })); return;
  }
  if (phase === 'snapshot') {
    assert(m.ready, 'finish chain setup first');
    const controlFile = path.join(dir, 'control.json'); assert(!fs.existsSync(controlFile) || !JSON.parse(fs.readFileSync(controlFile)).startedAt, 'do not replace a running snapshot');
    const runtime = path.join(dir, 'runtime'); fs.mkdirSync(runtime, { recursive: true });
    const limitedDb = localUrl(env.DATABASE_URL); limitedDb.searchParams.set('connection_limit', '4'); limitedDb.searchParams.set('pool_timeout', '15'); env.DATABASE_URL = limitedDb.href; writeEnv(env);
    fs.cpSync(path.join(root, 'scripts/soak'), path.join(runtime, 'soak'), { recursive: true });
    fs.cpSync(path.join(root, 'spot-api/dist'), path.join(runtime, 'api/dist'), { recursive: true });
    if (!fs.existsSync(path.join(runtime, 'api/node_modules'))) fs.symlinkSync(path.join(root, 'spot-api/node_modules'), path.join(runtime, 'api/node_modules'), 'dir');
    const publicEnv = dep('dotenv').parse(fs.readFileSync(path.join(root, 'lunes-dex-main/.env')));
    const publicOverrides = { REACT_APP_SPOT_API_URL: m.apiUrl, REACT_APP_SPOT_WS_URL: m.wsUrl, REACT_APP_RPC_TESTNET: m.network, REACT_APP_NETWORK: 'testnet', REACT_APP_FACTORY_CONTRACT: m.factory, REACT_APP_ROUTER_CONTRACT: m.router, REACT_APP_WNATIVE_CONTRACT: m.wrapped, REACT_APP_TOKEN_GMC: m.base, REACT_APP_TOKEN_LUSDT: m.quote };
    run(process.execPath, [path.join(root, 'lunes-dex-main/node_modules/vite/bin/vite.js'), 'build', '--outDir', path.join(dir, 'frontend')], { cwd: path.join(root, 'lunes-dex-main'), env: { ...process.env, ...publicEnv, ...publicOverrides } });
    const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    m.snapshot = { at: new Date().toISOString(), apiSha256: digest(path.join(runtime, 'api/dist/index.js')), frontendSha256: digest(path.join(dir, 'frontend/index.html')), scripts: Object.fromEntries(fs.readdirSync(path.join(runtime, 'soak')).filter(n => n.endsWith('.cjs')).map(n => [n, digest(path.join(runtime, 'soak', n))])) };
    atomicJson(path.join(dir, 'manifest.json'), m); console.log(JSON.stringify({ snapshot: m.snapshot.at })); return;
  }
  assert.equal(phase, 'chain');
  assert(!ctx.state.canaryCompleted?.length && !ctx.state.canaryPassedAt, 'do not refill wallets after testing begins');
  assert(!ctx.state.pendingTx, 'uncertain setup transaction: inspect journal');
  const c = await connect(ctx);
  try {
    m.genesis = c.genesis; m.users = c.users.map(u => u.address); m.lp = c.lp.address; m.relayer = c.relayer.address; m.treasury = c.treasury.address;
    const save = () => atomicJson(path.join(dir, 'manifest.json'), m); save();
    const alice = c.keyring.addFromUri('//Alice');
    for (const user of [...c.users, c.lp, c.relayer, c.treasury]) {
      const target = (user.address === c.lp.address || user.address === c.relayer.address ? 10000n : 1000n) * 100000000n;
      const balance = BigInt((await c.api.query.system.account(user.address)).data.free.toString());
      if (!m.ready && balance < target) await c.sendRaw(c.api.tx.balances.transferKeepAlive(user.address, target - balance), alice, 'fund.native');
    }
    if (!m.spot) { m.spot = await c.deploy('spot_settlement_contract', [c.treasury.address], m.id + '-vault'); save(); }
    const vault = c.contract('spot_settlement_contract', m.spot);
    if (!await c.query(vault, 'isRelayer', [c.relayer.address])) await c.send(vault, 'addRelayer', [c.relayer.address]);
    if (!m.attestorReady) {
      const { secp256k1PairFromSeed, secp256k1Compress } = ctx.dep('@polkadot/util-crypto');
      const pub = secp256k1Compress(secp256k1PairFromSeed(Buffer.from(ctx.secrets.attestorSeed, 'hex')).publicKey);
      await c.send(vault, 'setAttestorKey', [Array.from(pub)]); m.attestorReady = true; save();
    }
    assert.equal(await c.query(vault, 'isSignatureVerificationEnforced'), true);
    for (const [key, name, symbol, decimals] of [['base', 'Soak Base 46h', 'SB46', 8], ['quote', 'Soak USD 46h', 'SUSD46', 6]]) {
      if (!m[key]) { m[key] = await c.deploy('psp22_token', [name, symbol, decimals, 1000000000000n * 10n ** BigInt(decimals)], m.id + '-' + key); save(); }
    }
    const base = c.contract('psp22_token', m.base), quote = c.contract('psp22_token', m.quote);
    const factory = c.contract('factory_contract', m.factory);
    let pair = await c.query(factory, 'getPair', [m.base, m.quote]);
    if (!pair) { await c.send(factory, 'createPair', [m.base, m.quote]); pair = await c.query(factory, 'getPair', [m.base, m.quote]); }
    assert.equal(typeof pair, 'string'); m.pair = pair; save();
    const router = c.contract('router_contract', m.router), lpToken = c.contract('pair_contract', m.pair);
    for (const user of c.users) {
      for (const [token, address, dec, walletTarget, vaultTarget] of [[base, m.base, 8, 5000000n, 10000000n], [quote, m.quote, 6, 20000000n, 100000000n]]) {
        const scale = 10n ** BigInt(dec); const wallet = BigInt(await c.query(token, 'balanceOf', [user.address])); const ledger = BigInt(await c.query(vault, 'getBalance', [user.address, address]));
        const target = (walletTarget + vaultTarget) * scale;
        if (wallet + ledger < target) await c.send(token, 'transfer', [user.address, target - wallet - ledger, []]);
        if (ledger < vaultTarget * scale) { const delta = vaultTarget * scale - ledger; await c.send(token, 'approve', [m.spot, delta], user); await c.send(vault, 'depositPsp22', [address, delta], user); }
        if (BigInt(await c.query(token, 'allowance', [user.address, m.router])) < walletTarget * scale) await c.send(token, 'approve', [m.router, target], user);
      }
      if (BigInt(await c.query(vault, 'getBalance', [user.address, m.native])) < 100000000n) await c.send(vault, 'depositNative', [], user, 100000000n);
    }
    if (BigInt(await c.query(lpToken, 'balanceOf', [c.lp.address])) === 0n) {
      const a = 100000000n * 100000000n, b = 200000000n * 1000000n;
      await c.send(base, 'approve', [m.router, a * 10n]); await c.send(quote, 'approve', [m.router, b * 10n]);
      await c.send(router, 'addLiquidity', [m.base, m.quote, a, b, a, b, c.lp.address, Date.now() + 300000]);
    }
    if (!m.nativePoolReady) {
      let nativePair = await c.query(factory, 'getPair', [m.wrapped, m.quote]);
      if (!nativePair) { await c.send(factory, 'createPair', [m.wrapped, m.quote]); nativePair = await c.query(factory, 'getPair', [m.wrapped, m.quote]); }
      const nativeLp = c.contract('pair_contract', nativePair);
      if (BigInt(await c.query(nativeLp, 'totalSupply')) === 0n) {
        await c.send(quote, 'approve', [m.router, 1000000000000n]);
        await c.send(router, 'addLiquidityNative', [m.quote, 200000000n, 200000000n, 10000000000n, c.lp.address, Date.now() + 300000], c.lp, 10000000000n);
      }
      m.nativePair = nativePair; m.nativePoolReady = true; save();
    }
    const balances = [];
    for (const user of c.users) balances.push({ address: user.address, native: (await c.api.query.system.account(user.address)).data.free.toString(), walletBase: String(await c.query(base, 'balanceOf', [user.address])), walletQuote: String(await c.query(quote, 'balanceOf', [user.address])), vaultBase: String(await c.query(vault, 'getBalance', [user.address, m.base])), vaultQuote: String(await c.query(vault, 'getBalance', [user.address, m.quote])), vaultNative: String(await c.query(vault, 'getBalance', [user.address, m.native])) });
    for (const balance of balances) { assert.equal(BigInt(balance.walletBase), 5000000n * 100000000n); assert.equal(BigInt(balance.walletQuote), 20000000n * 1000000n); assert.equal(BigInt(balance.vaultBase), 10000000n * 100000000n); assert.equal(BigInt(balance.vaultQuote), 100000000n * 1000000n); assert.equal(BigInt(balance.vaultNative), 100000000n); }
    atomicJson(path.join(dir, 'funding-readback.json'), { at: new Date().toISOString(), balances, reserves: await c.query(lpToken, 'getReserves'), signatureVerificationEnforced: true });
    m.ready = true; save(); env.SPOT_CONTRACT_ADDRESS = m.spot; writeEnv(env);
    console.log(JSON.stringify({ ready: true, dir, users: m.users, vault: m.spot, pair: m.pair }));
  } finally { await c.api.disconnect(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
