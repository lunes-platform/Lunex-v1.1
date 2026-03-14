/**
 * Lunes Testnet Faucet
 *
 * Secure faucet with dedicated wallet, rate limiting, and web UI.
 * POST /faucet       { "address": "5..." }
 * GET  /faucet       Web UI page
 * GET  /faucet/status
 * GET  /health
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { ApiPromise, WsProvider } = require('@polkadot/api');
const { Keyring } = require('@polkadot/keyring');
const { mnemonicGenerate } = require('@polkadot/util-crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.FAUCET_PORT || 3333;
const WS_URL = process.env.LUNES_WS_URL || 'ws://lunes-testnet-node:9944';
const DRIP_AMOUNT = process.env.FAUCET_DRIP_AMOUNT || '10000000000000000'; // 10,000 LUNES (12 decimals)
const COOLDOWN_MINUTES = parseInt(process.env.FAUCET_COOLDOWN_MINUTES || '300', 10); // 5 hours
const SEED_FILE = process.env.FAUCET_SEED_FILE || '/data/faucet-seed.json';
const INITIAL_FUND = '500000000000000000'; // 500,000,000 LUNES from Alice
const DAILY_LIMIT = parseInt(process.env.FAUCET_DAILY_LIMIT || '50', 10); // max 50 drips/day

let api = null;
let faucetAccount = null;
let dailyDripCount = 0;
let lastDayReset = new Date().toDateString();

// Track drips: { address -> timestamp, ip -> [timestamps] }
const addressHistory = new Map();
const ipHistory = new Map();

/**
 * Generate or load a dedicated faucet seed (NOT //Alice)
 */
function loadOrCreateSeed() {
  try {
    if (fs.existsSync(SEED_FILE)) {
      const data = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
      console.log('[faucet] 🔑 Loaded existing faucet seed');
      return data.mnemonic;
    }
  } catch (e) {
    console.log('[faucet] Could not load seed file, generating new one');
  }

  const mnemonic = mnemonicGenerate();
  const dir = path.dirname(SEED_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SEED_FILE, JSON.stringify({ mnemonic, createdAt: new Date().toISOString() }), { mode: 0o600 });
  console.log('[faucet] 🔐 Generated NEW faucet seed (stored securely)');
  return mnemonic;
}

/**
 * Transfer initial funds from Alice to faucet wallet
 */
async function fundFaucetFromAlice(faucetAddress) {
  const keyring = new Keyring({ type: 'sr25519' });
  const alice = keyring.addFromUri('//Alice');

  const { data: faucetBalance } = await api.query.system.account(faucetAddress);
  const minBalance = BigInt(INITIAL_FUND) / 10n;

  if (BigInt(faucetBalance.free.toString()) > minBalance) {
    console.log(`[faucet] Faucet already funded: ${faucetBalance.free.toHuman()}`);
    return;
  }

  console.log(`[faucet] 💰 Funding faucet from Alice (${BigInt(INITIAL_FUND).toLocaleString()} units)...`);

  await new Promise((resolve, reject) => {
    api.tx.balances.transferKeepAlive(faucetAddress, INITIAL_FUND)
      .signAndSend(alice, ({ status, dispatchError }) => {
        if (dispatchError) {
          if (dispatchError.isModule) {
            const decoded = api.registry.findMetaError(dispatchError.asModule);
            reject(new Error(`${decoded.section}.${decoded.name}`));
          } else {
            reject(new Error(dispatchError.toString()));
          }
        }
        if (status.isInBlock) resolve();
      });
  });

  const { data: newBalance } = await api.query.system.account(faucetAddress);
  console.log(`[faucet] ✅ Faucet funded! Balance: ${newBalance.free.toHuman()}`);
}

async function connectChain() {
  const provider = new WsProvider(WS_URL);
  console.log(`[faucet] Connecting to ${WS_URL}...`);
  api = await ApiPromise.create({ provider });

  const chain = await api.rpc.system.chain();
  const [nodeName, nodeVersion] = await Promise.all([
    api.rpc.system.name(),
    api.rpc.system.version(),
  ]);

  // Load or create dedicated faucet seed
  const mnemonic = loadOrCreateSeed();
  const keyring = new Keyring({ type: 'sr25519' });
  faucetAccount = keyring.addFromMnemonic(mnemonic);

  console.log(`[faucet] Connected to ${chain} (${nodeName} v${nodeVersion})`);
  console.log(`[faucet] Faucet address: ${faucetAccount.address}`);

  // Fund from Alice if needed
  await fundFaucetFromAlice(faucetAccount.address);

  const { data: balance } = await api.query.system.account(faucetAccount.address);
  console.log(`[faucet] Faucet balance: ${balance.free.toHuman()}`);
  console.log(`[faucet] Drip: ${BigInt(DRIP_AMOUNT).toLocaleString()} units | Cooldown: ${COOLDOWN_MINUTES}min | Daily limit: ${DAILY_LIMIT}`);
}

function canDrip(address, ip) {
  // Check address cooldown
  const lastDrip = addressHistory.get(address);
  if (lastDrip) {
    const elapsed = Date.now() - lastDrip;
    const cooldownMs = COOLDOWN_MINUTES * 60 * 1000;
    if (elapsed < cooldownMs) {
      const remaining = Math.ceil((cooldownMs - elapsed) / 60000);
      const hours = Math.floor(remaining / 60);
      const mins = remaining % 60;
      return { allowed: false, reason: `Address already received tokens. Try again in ${hours}h ${mins}m.` };
    }
  }

  // Check IP rate (max 3 different addresses per IP per day)
  const ipDrips = ipHistory.get(ip) || [];
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentIpDrips = ipDrips.filter(t => t > oneDayAgo);
  if (recentIpDrips.length >= 3) {
    return { allowed: false, reason: 'IP limit reached: maximum 3 requests per 24 hours.' };
  }

  // Check daily global limit
  if (new Date().toDateString() !== lastDayReset) {
    dailyDripCount = 0;
    lastDayReset = new Date().toDateString();
  }
  if (dailyDripCount >= DAILY_LIMIT) {
    return { allowed: false, reason: 'Daily faucet limit reached. Try again tomorrow.' };
  }

  return { allowed: true };
}

function recordDrip(address, ip) {
  addressHistory.set(address, Date.now());
  const ipDrips = ipHistory.get(ip) || [];
  ipDrips.push(Date.now());
  ipHistory.set(ip, ipDrips);
  dailyDripCount++;
}

const app = express();
app.use(express.json());
app.set('trust proxy', true);

// Global rate limit
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down.' },
});

// Faucet drip rate limit (per IP)
const faucetLimiter = rateLimit({
  windowMs: 5 * 60 * 60 * 1000, // 5 hours
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded. Try again later.' },
});

app.use(globalLimiter);

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Health
app.get('/health', (req, res) => {
  res.json({ status: api?.isConnected ? 'healthy' : 'disconnected' });
});

// ═══════════════════════════════════════════════════════════════════
// Faucet Web UI (GET /faucet)
// ═══════════════════════════════════════════════════════════════════
app.get('/faucet', (req, res) => {
  const cooldownHours = Math.floor(COOLDOWN_MINUTES / 60);
  const dripHuman = (BigInt(DRIP_AMOUNT) / 1000000000000n).toString();
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lunes Testnet Faucet — Free Test LUNES Tokens</title>
  <meta name="description" content="Get free Lunes testnet tokens for blockchain development. ${dripHuman} LUNES per request with ${cooldownHours}-hour cooldown.">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "Lunes Testnet Faucet",
    "url": "https://sandbox.lunes.io/faucet",
    "description": "Free testnet LUNES token faucet for blockchain development. ${dripHuman} LUNES per request.",
    "applicationCategory": "BlockchainApplication",
    "operatingSystem": "Web",
    "provider": {
      "@type": "Organization",
      "name": "Lunes Platform",
      "url": "https://lunes.io"
    }
  }
  </script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', sans-serif;
      background: #0a0a0f;
      color: #e4e4e7;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      max-width: 520px;
      width: 100%;
      padding: 20px;
    }
    .card {
      background: linear-gradient(145deg, #13131a 0%, #0d0d14 100%);
      border: 1px solid #1e1e2e;
      border-radius: 16px;
      padding: 40px 32px;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
    }
    .logo {
      text-align: center;
      margin-bottom: 8px;
      font-size: 48px;
    }
    h1 {
      text-align: center;
      font-size: 24px;
      font-weight: 700;
      background: linear-gradient(135deg, #60a5fa, #a78bfa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 6px;
    }
    .subtitle {
      text-align: center;
      color: #71717a;
      font-size: 14px;
      margin-bottom: 32px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 28px;
    }
    .info-box {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 10px;
      padding: 14px;
      text-align: center;
    }
    .info-box .label {
      font-size: 11px;
      color: #71717a;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .info-box .value {
      font-size: 18px;
      font-weight: 600;
      color: #e4e4e7;
    }
    .input-group {
      margin-bottom: 16px;
    }
    .input-group label {
      display: block;
      font-size: 13px;
      color: #a1a1aa;
      margin-bottom: 8px;
      font-weight: 500;
    }
    input[type="text"] {
      width: 100%;
      padding: 14px 16px;
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 10px;
      color: #e4e4e7;
      font-size: 14px;
      font-family: 'Inter', monospace;
      outline: none;
      transition: border-color 0.2s;
    }
    input[type="text"]:focus {
      border-color: #60a5fa;
    }
    input[type="text"]::placeholder {
      color: #52525b;
    }
    .btn {
      width: 100%;
      padding: 14px;
      background: linear-gradient(135deg, #3b82f6, #6366f1);
      color: #fff;
      border: none;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s, transform 0.1s;
      font-family: 'Inter', sans-serif;
    }
    .btn:hover { opacity: 0.9; }
    .btn:active { transform: scale(0.98); }
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }
    .result {
      margin-top: 16px;
      padding: 14px;
      border-radius: 10px;
      font-size: 13px;
      line-height: 1.5;
      display: none;
    }
    .result.success {
      background: #052e16;
      border: 1px solid #166534;
      color: #86efac;
      display: block;
    }
    .result.error {
      background: #450a0a;
      border: 1px solid #991b1b;
      color: #fca5a5;
      display: block;
    }
    .result.loading {
      background: #1e1b4b;
      border: 1px solid #3730a3;
      color: #a5b4fc;
      display: block;
    }
    .rpc-section {
      margin-top: 20px;
      padding: 14px;
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 10px;
    }
    .rpc-section h3 {
      font-size: 13px;
      color: #a1a1aa;
      margin-bottom: 10px;
    }
    .rpc-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .rpc-row:last-child { margin-bottom: 0; }
    .rpc-label {
      font-size: 11px;
      color: #71717a;
      text-transform: uppercase;
      min-width: 32px;
    }
    .rpc-url {
      flex: 1;
      font-size: 12px;
      color: #a5b4fc;
      font-family: monospace;
      background: #0d0d14;
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid #1e1e2e;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .copy-btn {
      background: #27272a;
      border: 1px solid #3f3f46;
      color: #a1a1aa;
      padding: 6px 10px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .copy-btn:hover {
      background: #3f3f46;
      color: #e4e4e7;
    }
    .copy-btn.copied {
      background: #166534;
      border-color: #22c55e;
      color: #86efac;
    }
    .footer {
      text-align: center;
      margin-top: 20px;
      font-size: 12px;
      color: #52525b;
    }
    .footer a {
      color: #60a5fa;
      text-decoration: none;
    }
    .rules {
      margin-top: 20px;
      padding: 14px;
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 10px;
    }
    .rules h3 {
      font-size: 13px;
      color: #a1a1aa;
      margin-bottom: 8px;
    }
    .rules li {
      font-size: 12px;
      color: #71717a;
      margin-left: 16px;
      margin-bottom: 4px;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- WebMCP: AI-discoverable faucet form -->
    <div class="card"
      to-name="requestTestnetTokens"
      to-description="Request free Lunes testnet tokens for blockchain development. Send ${dripHuman} LUNES to a Lunes wallet address. Cooldown: ${cooldownHours} hours per address."
    >
      <div class="logo">🚰</div>
      <h1>Lunes Testnet Faucet</h1>
      <p class="subtitle">Get free testnet LUNES tokens for development</p>

      <div class="info-grid">
        <div class="info-box">
          <div class="label">Per Request</div>
          <div class="value">${dripHuman} LUNES</div>
        </div>
        <div class="info-box">
          <div class="label">Cooldown</div>
          <div class="value">${cooldownHours} hours</div>
        </div>
      </div>

      <form id="faucetForm" onsubmit="requestTokens(); return false;"
        to-name="requestTestnetTokens"
        to-description="Request free Lunes testnet tokens. Sends ${dripHuman} LUNES to the provided wallet address."
        to-auto-submit="true"
      >
        <div class="input-group">
          <label for="address">Lunes Address</label>
          <input type="text" id="address" name="address"
            placeholder="5YourLunesAddress..."
            autocomplete="off" spellcheck="false"
            to-param-title="recipientAddress"
          >
        </div>

        <button type="submit" class="btn" id="requestBtn">
          Request Tokens
        </button>
      </form>

      <div class="result" id="result"></div>

      <!-- RPC Endpoints — Copy to clipboard -->
      <div class="rpc-section"
        to-name="lunesTestnetRPC"
        to-description="Lunes Testnet RPC endpoints for connecting wallets and applications"
      >
        <h3>🔗 Testnet RPC Endpoints</h3>
        <div class="rpc-row">
          <span class="rpc-label">WSS</span>
          <span class="rpc-url" id="rpcWss">wss://sandbox.lunes.io/ws</span>
          <button class="copy-btn" onclick="copyRpc('rpcWss', this)">Copy</button>
        </div>
        <div class="rpc-row">
          <span class="rpc-label">RPC</span>
          <span class="rpc-url" id="rpcHttp">https://sandbox.lunes.io</span>
          <button class="copy-btn" onclick="copyRpc('rpcHttp', this)">Copy</button>
        </div>
      </div>

      <div class="rules">
        <h3>⚠️ Rules</h3>
        <ul>
          <li>${dripHuman} LUNES per request</li>
          <li>${cooldownHours}-hour cooldown per address</li>
          <li>Max 3 requests per IP per 24h</li>
          <li>Testnet tokens have no real value</li>
        </ul>
      </div>
    </div>

    <div class="footer">
      <p>Powered by <a href="https://lunes.io" target="_blank">Lunes Platform</a></p>
      <p style="margin-top:4px">
        Explorer: <a href="https://polkadot.js.org/apps/?rpc=wss://sandbox.lunes.io/ws" target="_blank">Lunes Explorer</a>
      </p>
    </div>
  </div>

  <script>
    function copyRpc(elementId, btn) {
      const text = document.getElementById(elementId).textContent;
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = '✓ Copied';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 2000);
      });
    }

    async function requestTokens() {
      const address = document.getElementById('address').value.trim();
      const btn = document.getElementById('requestBtn');
      const result = document.getElementById('result');

      if (!address || !address.startsWith('5') || address.length < 40) {
        result.className = 'result error';
        result.textContent = 'Please enter a valid Lunes address (starts with 5)';
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Sending...';
      result.className = 'result loading';
      result.textContent = '⏳ Submitting transaction to the blockchain...';

      try {
        const res = await fetch('/faucet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address })
        });
        const data = await res.json();

        if (data.success) {
          result.className = 'result success';
          result.innerHTML = '✅ <strong>Tokens sent!</strong><br>' +
            'Amount: ' + data.amount + '<br>' +
            'Block: <code>' + data.blockHash.substring(0,18) + '...</code>';
        } else {
          result.className = 'result error';
          result.textContent = '❌ ' + (data.error || 'Unknown error');
        }
      } catch (err) {
        result.className = 'result error';
        result.textContent = '❌ Network error: ' + err.message;
      }

      btn.disabled = false;
      btn.textContent = 'Request Tokens';
    }
  </script>
</body>
</html>`);
});

// Faucet status
app.get('/faucet/status', async (req, res) => {
  try {
    if (!api?.isConnected) return res.status(503).json({ error: 'Chain not connected' });

    const { data: balance } = await api.query.system.account(faucetAccount.address);
    res.json({
      network: 'Lunes Testnet',
      faucetAddress: faucetAccount.address,
      balance: balance.free.toHuman(),
      dripAmount: (BigInt(DRIP_AMOUNT) / 1000000000000n).toString() + ' LUNES',
      cooldownHours: Math.floor(COOLDOWN_MINUTES / 60),
      dailyDripsRemaining: Math.max(0, DAILY_LIMIT - dailyDripCount),
      totalTrackedAddresses: addressHistory.size,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Drip tokens
app.post('/faucet', faucetLimiter, async (req, res) => {
  try {
    const { address } = req.body;
    const ip = req.ip || req.connection.remoteAddress;

    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'Missing "address" field.' });
    }
    if (!address.startsWith('5') || address.length < 40) {
      return res.status(400).json({ error: 'Invalid Lunes address format.' });
    }
    if (!api?.isConnected) {
      return res.status(503).json({ error: 'Blockchain not connected. Try again later.' });
    }

    // Anti-drain checks
    const { allowed, reason } = canDrip(address, ip);
    if (!allowed) {
      return res.status(429).json({ error: reason });
    }

    console.log(`[faucet] 💧 Dripping to ${address} (IP: ${ip.replace(/^.*:/, '')})`);

    const transfer = api.tx.balances.transferKeepAlive(address, DRIP_AMOUNT);
    const hash = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Transaction timeout (30s)')), 30000);
      transfer.signAndSend(faucetAccount, ({ status, dispatchError }) => {
        if (dispatchError) {
          clearTimeout(timeout);
          if (dispatchError.isModule) {
            const decoded = api.registry.findMetaError(dispatchError.asModule);
            reject(new Error(`${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`));
          } else {
            reject(new Error(dispatchError.toString()));
          }
        }
        if (status.isInBlock) {
          clearTimeout(timeout);
          resolve(status.asInBlock.toHex());
        }
      });
    });

    recordDrip(address, ip);
    const dripHuman = (BigInt(DRIP_AMOUNT) / 1000000000000n).toString();
    console.log(`[faucet] ✅ Sent ${dripHuman} LUNES to ${address} — block: ${hash}`);

    res.json({
      success: true,
      address,
      amount: dripHuman + ' LUNES',
      blockHash: hash,
    });
  } catch (err) {
    console.error('[faucet] ❌', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Start
async function main() {
  await connectChain();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[faucet] 🚰 Faucet live on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('[faucet] Fatal:', err);
  process.exit(1);
});
