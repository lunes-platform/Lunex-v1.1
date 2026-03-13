#!/usr/bin/env ts-node

/**
 * LUNEX DEX - Deploy PSP22 Asset Wrappers for pallet-assets tokens
 *
 * Deploys one AssetWrapper contract per pallet-asset, making them
 * compatible with the Router (Swap) and spot-api (Orderbook).
 *
 * Usage:
 *   npx ts-node scripts/deploy-asset-wrappers.ts --network testnet --seed "//Alice"
 */

import { ApiPromise, WsProvider, Keyring } from '@polkadot/api';
import { ContractPromise, CodePromise } from '@polkadot/api-contract';
import { BN } from '@polkadot/util';
import * as fs from 'fs';
import * as path from 'path';

type ContractApi = ConstructorParameters<typeof ContractPromise>[0];
type CodeApi = ConstructorParameters<typeof CodePromise>[0];

function asContractApi(api: ApiPromise): ContractApi {
  return api as unknown as ContractApi;
}

function asCodeApi(api: ApiPromise): CodeApi {
  return api as unknown as CodeApi;
}

// ─── Configuration ───

const NETWORKS: Record<string, { endpoint: string; name: string }> = {
  local: { endpoint: 'ws://127.0.0.1:9944', name: 'Lunes Local' },
  testnet: { endpoint: 'wss://ws-test.lunes.io', name: 'Lunes Testnet' },
  mainnet: { endpoint: 'wss://ws.lunes.io', name: 'Lunes Mainnet' },
};

// Pallet-assets to wrap
const ASSETS_TO_WRAP = [
  { id: 1, name: 'Wrapped PIDCHAT', symbol: 'wPIDCHAT', decimals: 8 },
  { id: 2, name: 'Wrapped LUNES DOLLAR', symbol: 'wLUSDT', decimals: 8 },
  { id: 3, name: 'Wrapped Groovy Gang', symbol: 'wGGNG', decimals: 8 },
];

const CONTRACT_PATH = './Lunex/contracts/asset_wrapper/target/ink/asset_wrapper_contract.contract';

const GAS_LIMIT = new BN('1000000000000');       // 10,000 LUNES
const STORAGE_DEPOSIT = new BN('1000000000000');  // 10,000 LUNES

// ─── Deploy Logic ───

interface DeployResult {
  assetId: number;
  name: string;
  symbol: string;
  contractAddress: string;
  txHash: string;
}

async function deployWrapper(
  api: ApiPromise,
  adminAccount: any,
  contractData: any,
  asset: typeof ASSETS_TO_WRAP[0],
): Promise<DeployResult> {
  console.log(`\n--- Deploying wrapper for ${asset.symbol} (asset #${asset.id}) ---`);

  const code = new CodePromise(asCodeApi(api), contractData, contractData.source.wasm);

  const tx = code.tx['new'](
    { gasLimit: GAS_LIMIT, storageDepositLimit: STORAGE_DEPOSIT },
    asset.id,                                   // asset_id: u32
    adminAccount.address,                       // admin: AccountId (relayer)
    asset.name,                                 // name: Option<String>
    asset.symbol,                               // symbol: Option<String>
    asset.decimals,                             // decimals: u8
    0,                                          // mint_cap: Balance (0 = unlimited)
  );

  return new Promise((resolve, reject) => {
    let contractAddress = '';
    let txHash = '';

    tx.signAndSend(adminAccount, { nonce: -1 }, (result: any) => {
      const { status, events, txHash: hash } = result;
      txHash = hash?.toString() || '';

      if (status.isInBlock || status.isFinalized) {
        for (const { event } of events) {
          if (event.section === 'contracts' && event.method === 'Instantiated') {
            contractAddress = event.data[1]?.toString() || '';
          }
        }

        if (contractAddress) {
          console.log(`  Address: ${contractAddress}`);
          console.log(`  Tx:      ${txHash}`);
          resolve({
            assetId: asset.id,
            name: asset.name,
            symbol: asset.symbol,
            contractAddress,
            txHash,
          });
        } else {
          // Check for errors
          const failedEvent = events.find(({ event: e }: any) =>
            e.section === 'system' && e.method === 'ExtrinsicFailed'
          );
          if (failedEvent) {
            reject(new Error(`Deploy failed for ${asset.symbol}: ExtrinsicFailed`));
          } else {
            reject(new Error(`Deploy failed for ${asset.symbol}: no Instantiated event`));
          }
        }
      }
    }).catch(reject);
  });
}

async function main() {
  // Parse CLI args
  const args = process.argv.slice(2);
  const networkIdx = args.indexOf('--network');
  const seedIdx = args.indexOf('--seed');

  const networkName = networkIdx >= 0 ? args[networkIdx + 1] : 'local';
  const seed = seedIdx >= 0 ? args[seedIdx + 1] : '//Alice';

  const network = NETWORKS[networkName];
  if (!network) {
    console.error(`Unknown network: ${networkName}. Use: local | testnet | mainnet`);
    process.exit(1);
  }

  // Load contract
  const contractPath = path.resolve(CONTRACT_PATH);
  if (!fs.existsSync(contractPath)) {
    console.error(`Contract not found: ${contractPath}`);
    console.error('\nBuild the contract first:');
    console.error('  cd Lunex/contracts/asset_wrapper && cargo contract build --release');
    process.exit(1);
  }

  const contractData = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

  // Connect
  console.log(`Connecting to ${network.name} (${network.endpoint})...`);
  const provider = new WsProvider(network.endpoint);
  const api = await ApiPromise.create({ provider });
  await api.isReady;

  const keyring = new Keyring({ type: 'sr25519' });
  const adminAccount = keyring.addFromUri(seed);
  console.log(`Admin account: ${adminAccount.address}`);

  // Check balance
  const { data: balanceData } = (await api.query.system.account(adminAccount.address)) as any;
  const freeLunes = balanceData.free.toBn().div(new BN('100000000')).toString();
  console.log(`Balance: ${freeLunes} LUNES`);

  // Deploy each wrapper
  const results: DeployResult[] = [];

  for (const asset of ASSETS_TO_WRAP) {
    try {
      const result = await deployWrapper(api, adminAccount, contractData, asset);
      results.push(result);
    } catch (err) {
      console.error(`Failed to deploy ${asset.symbol}:`, err);
    }
  }

  // Save deployment results
  const outputPath = path.resolve(`./deployment-wrappers-${Date.now()}.json`);
  const output = {
    network: networkName,
    admin: adminAccount.address,
    deployedAt: new Date().toISOString(),
    wrappers: results,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nDeployment saved to: ${outputPath}`);

  // Summary
  console.log('\n=== Deployment Summary ===');
  for (const r of results) {
    console.log(`  ${r.symbol} (asset #${r.assetId}): ${r.contractAddress}`);
  }

  // Bridge service config hint
  console.log('\n=== Bridge Service Config ===');
  console.log('Add to spot-api .env:');
  console.log(`BRIDGE_ADMIN_SEED="${seed}"`);
  console.log(`BRIDGE_ASSETS='${JSON.stringify(results.map(r => ({
    assetId: r.assetId,
    wrapperAddress: r.contractAddress,
    symbol: r.symbol,
  })))}'`);

  await api.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Deploy failed:', err);
  process.exit(1);
});
