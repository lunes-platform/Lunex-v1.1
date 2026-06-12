const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');

const checks = [
  {
    id: 'finality-only-fund-paths',
    files: [
      'src/services/rewardPayoutService.ts',
      'src/services/rebalancerService.ts',
      'src/services/emergencyService.ts',
    ],
    forbidden: [
      /status\.isInBlock/,
      /txResult\.status\.isInBlock/,
      /isInBlock\s*\|\|\s*.*isFinalized/,
      /isFinalized\s*\|\|\s*.*isInBlock/,
    ],
  },
  {
    id: 'no-bridge-dev-seed-fallback',
    files: ['src/services/assetBridgeService.ts'],
    forbidden: [
      /BRIDGE_ADMIN_SEED\s*\|\|\s*['"]\/\/Alice['"]/,
      /adminSeed\s*=\s*process\.env\.BRIDGE_ADMIN_SEED/,
      /LUNES_WS_ENDPOINT/,
    ],
  },
  {
    id: 'production-guards-cover-bridge-and-chain',
    files: ['src/utils/productionGuards.ts'],
    required: [
      'BRIDGE_ADMIN_SEED is required in production',
      'FACTORY_CONTRACT_ADDRESS is required in production',
      'LUNES_WS_URL must not point to localhost in production',
    ],
  },
  {
    id: 'synthetic-orders-blocked-when-settlement-enabled',
    files: ['src/routes/tradeApi.ts', 'src/services/routerService.ts'],
    required: ['settlementService.isEnabled()'],
  },
  {
    id: 'no-signed-read-auth-in-client-query-strings',
    baseDir: repoRoot,
    files: [
      'lunes-dex-main/src/services/spotService.ts',
      'lunes-dex-main/src/services/socialService.ts',
      'lunes-dex-main/src/services/rewardsService.ts',
      'lunes-dex-main/src/services/strategyService.ts',
      'lunes-dex-main/src/services/marginService.ts',
      'lunes-dex-main/src/services/agentService.ts',
      'lunes-dex-main/src/pages/affiliates/index.tsx',
      'lunes-dex-main/src/pages/governance/index.tsx',
      'sdk/src/modules/orders.ts',
      'sdk/src/modules/copytrade.ts',
      'sdk/src/modules/agents.ts',
      'sdk/src/modules/asymmetric/AsymmetricClient.ts',
      'mcp/lunex-agent-mcp/src/index.ts',
    ],
    forbidden: [
      /[?&](?:nonce|timestamp|signature)=/,
      /signature=\$\{/,
      /nonce=.*signature/,
      /signature=.*nonce/,
    ],
  },
];

const failures = [];

for (const check of checks) {
  for (const relativeFile of check.files) {
    const absoluteFile = path.join(check.baseDir || root, relativeFile);
    const source = fs.readFileSync(absoluteFile, 'utf8');

    for (const pattern of check.forbidden || []) {
      if (pattern.test(source)) {
        failures.push(`${check.id}: ${relativeFile} matched ${pattern}`);
      }
    }

    for (const expected of check.required || []) {
      if (!source.includes(expected)) {
        failures.push(`${check.id}: ${relativeFile} is missing "${expected}"`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Production regression checks failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Production regression checks passed.');
