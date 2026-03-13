#!/usr/bin/env tsx

/**
 * 🔍 SCRIPT DE VERIFICAÇÃO DE DEPLOYMENT - LUNEX DEX
 * 
 * Verifica se todos os contratos foram implantados corretamente
 * e suas configurações estão consistentes na rede Lunes.
 * 
 * Uso:
 * npm run verify:deployment [network]
 * 
 * Onde network pode ser: testnet, mainnet
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { ContractPromise } from '@polkadot/api-contract';
import { Keyring } from '@polkadot/keyring';
import fs from 'fs';
import path from 'path';

type ContractApi = ConstructorParameters<typeof ContractPromise>[0];

function asContractApi(api: ApiPromise): ContractApi {
  return api as unknown as ContractApi;
}

// === CONFIGURAÇÃO ===

interface NetworkConfig {
  name: string;
  wsEndpoint: string;
  blockExplorer?: string;
}

interface ContractInfo {
  name: string;
  address: string;
  abi: any;
}

interface DeploymentConfig {
  network: string;
  contracts: {
    factory: ContractInfo;
    router: ContractInfo;
    psp22: ContractInfo;
    wnative: ContractInfo;
    staking: ContractInfo;
    rewards: ContractInfo;
  };
  expectedConfigurations: {
    factory: {
      feeTo?: string;
      feeToSetter: string;
    };
    router: {
      factory: string;
      wnative: string;
    };
    staking: {
      owner: string;
      treasury: string;
      tradingRewardsContract: string;
    };
    rewards: {
      admin: string;
      router: string;
      stakingContract: string;
    };
  };
}

const NETWORKS: Record<string, NetworkConfig> = {
  testnet: {
    name: 'Lunes Testnet',
    wsEndpoint: 'wss://ws-test.lunes.io',
    blockExplorer: 'https://explorer-test.lunes.io'
  },
  mainnet: {
    name: 'Lunes Mainnet',
    wsEndpoint: 'wss://ws.lunes.io',
    blockExplorer: 'https://explorer.lunes.io'
  }
};

// === UTILITÁRIOS ===

function loadDeploymentConfig(network: string): DeploymentConfig {
  const configPath = path.join(__dirname, '..', 'deployment', `${network}.json`);
  
  if (!fs.existsSync(configPath)) {
    throw new Error(`❌ Arquivo de configuração não encontrado: ${configPath}`);
  }
  
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return config as DeploymentConfig;
}

function loadContractABI(contractName: string): any {
  const abiPath = path.join(__dirname, '..', 'target', 'ink', contractName, `${contractName}.json`);
  
  if (!fs.existsSync(abiPath)) {
    throw new Error(`❌ ABI não encontrada: ${abiPath}`);
  }
  
  return JSON.parse(fs.readFileSync(abiPath, 'utf8'));
}

async function connectToNetwork(network: string): Promise<ApiPromise> {
  const config = NETWORKS[network];
  if (!config) {
    throw new Error(`❌ Rede não suportada: ${network}`);
  }
  
  console.log(`🌐 Conectando à ${config.name}...`);
  console.log(`📡 Endpoint: ${config.wsEndpoint}`);
  
  const provider = new WsProvider(config.wsEndpoint);
  const api = await ApiPromise.create({ provider });
  
  const [chain, nodeName, nodeVersion] = await Promise.all([
    api.rpc.system.chain(),
    api.rpc.system.name(),
    api.rpc.system.version()
  ]);
  
  console.log(`✅ Conectado: ${chain} (${nodeName} v${nodeVersion})`);
  return api;
}

// === VERIFICAÇÕES ===

class DeploymentVerifier {
  constructor(
    private api: ApiPromise,
    private config: DeploymentConfig
  ) {}

  async verifyAll(): Promise<boolean> {
    console.log('\n🔍 === VERIFICAÇÃO DE DEPLOYMENT ===\n');
    
    let allGood = true;
    
    // 1. Verificar se contratos existem
    allGood = await this.verifyContractsExist() && allGood;
    
    // 2. Verificar configurações
    allGood = await this.verifyConfigurations() && allGood;
    
    // 3. Verificar integrações
    allGood = await this.verifyIntegrations() && allGood;
    
    // 4. Verificar permissões
    allGood = await this.verifyPermissions() && allGood;
    
    // 5. Verificar funcionalidades básicas
    allGood = await this.verifyBasicFunctionality() && allGood;
    
    console.log('\n' + '='.repeat(50));
    if (allGood) {
      console.log('✅ TODOS OS CONTRATOS ESTÃO FUNCIONANDO CORRETAMENTE!');
    } else {
      console.log('❌ ALGUNS PROBLEMAS FORAM ENCONTRADOS. VERIFIQUE OS LOGS ACIMA.');
    }
    console.log('='.repeat(50) + '\n');
    
    return allGood;
  }

  private async verifyContractsExist(): Promise<boolean> {
    console.log('📋 1. Verificando existência dos contratos...\n');
    
    let allExist = true;
    
    for (const [name, info] of Object.entries(this.config.contracts)) {
      console.log(`🔍 Verificando ${name.toUpperCase()}...`);
      console.log(`   📍 Endereço: ${info.address}`);
      
      try {
        // Verificar se o endereço tem código
        const codeHash = await this.api.query.contracts.contractInfoOf(info.address) as any;
        
        if (codeHash?.isSome) {
          console.log(`   ✅ Contrato encontrado com code hash: ${codeHash.unwrap().codeHash.toHex()}`);
        } else {
          console.log(`   ❌ Nenhum código encontrado no endereço!`);
          allExist = false;
        }
      } catch (error) {
        console.log(`   ❌ Erro ao verificar contrato: ${error}`);
        allExist = false;
      }
      
      console.log('');
    }
    
    return allExist;
  }

  private async verifyConfigurations(): Promise<boolean> {
    console.log('⚙️  2. Verificando configurações dos contratos...\n');
    
    let allConfigured = true;
    
    // Factory
    console.log('🏭 FACTORY:');
    try {
      const factoryContract = new ContractPromise(
        asContractApi(this.api),
        this.config.contracts.factory.abi,
        this.config.contracts.factory.address
      );
      
      // Verificar fee_to_setter
      const feeToSetter = await this.queryContract(factoryContract, 'getFeeToSetter', []);
      console.log(`   📊 Fee To Setter: ${feeToSetter}`);
      
      if (feeToSetter !== this.config.expectedConfigurations.factory.feeToSetter) {
        console.log(`   ❌ Fee To Setter incorreto! Esperado: ${this.config.expectedConfigurations.factory.feeToSetter}`);
        allConfigured = false;
      } else {
        console.log(`   ✅ Fee To Setter configurado corretamente`);
      }
      
    } catch (error) {
      console.log(`   ❌ Erro na Factory: ${error}`);
      allConfigured = false;
    }
    
    // Router
    console.log('\n🛣️  ROUTER:');
    try {
      const routerContract = new ContractPromise(
        asContractApi(this.api),
        this.config.contracts.router.abi,
        this.config.contracts.router.address
      );
      
      const factory = await this.queryContract(routerContract, 'factory', []);
      const wnative = await this.queryContract(routerContract, 'wLunes', []);
      
      console.log(`   🏭 Factory: ${factory}`);
      console.log(`   💰 WNative: ${wnative}`);
      
      if (factory !== this.config.expectedConfigurations.router.factory) {
        console.log(`   ❌ Factory incorreta! Esperado: ${this.config.expectedConfigurations.router.factory}`);
        allConfigured = false;
      } else {
        console.log(`   ✅ Factory configurada corretamente`);
      }
      
      if (wnative !== this.config.expectedConfigurations.router.wnative) {
        console.log(`   ❌ WNative incorreto! Esperado: ${this.config.expectedConfigurations.router.wnative}`);
        allConfigured = false;
      } else {
        console.log(`   ✅ WNative configurado corretamente`);
      }
      
    } catch (error) {
      console.log(`   ❌ Erro no Router: ${error}`);
      allConfigured = false;
    }
    
    // Staking
    console.log('\n🥩 STAKING:');
    try {
      const stakingContract = new ContractPromise(
        asContractApi(this.api),
        this.config.contracts.staking.abi,
        this.config.contracts.staking.address
      );
      
      const owner = await this.queryContract(stakingContract, 'owner', []);
      console.log(`   👑 Owner: ${owner}`);
      
      if (owner !== this.config.expectedConfigurations.staking.owner) {
        console.log(`   ❌ Owner incorreto! Esperado: ${this.config.expectedConfigurations.staking.owner}`);
        allConfigured = false;
      } else {
        console.log(`   ✅ Owner configurado corretamente`);
      }
      
    } catch (error) {
      console.log(`   ❌ Erro no Staking: ${error}`);
      allConfigured = false;
    }
    
    // Trading Rewards
    console.log('\n🎁 TRADING REWARDS:');
    try {
      const rewardsContract = new ContractPromise(
        asContractApi(this.api),
        this.config.contracts.rewards.abi,
        this.config.contracts.rewards.address
      );
      
      const admin = await this.queryContract(rewardsContract, 'admin', []);
      console.log(`   👑 Admin: ${admin}`);
      
      if (admin !== this.config.expectedConfigurations.rewards.admin) {
        console.log(`   ❌ Admin incorreto! Esperado: ${this.config.expectedConfigurations.rewards.admin}`);
        allConfigured = false;
      } else {
        console.log(`   ✅ Admin configurado corretamente`);
      }
      
    } catch (error) {
      console.log(`   ❌ Erro no Trading Rewards: ${error}`);
      allConfigured = false;
    }
    
    console.log('');
    return allConfigured;
  }

  private async verifyIntegrations(): Promise<boolean> {
    console.log('🔗 3. Verificando integrações entre contratos...\n');
    
    let allIntegrated = true;
    
    try {
      // Verificar se Staking conhece o Trading Rewards
      const stakingContract = new ContractPromise(
        asContractApi(this.api),
        this.config.contracts.staking.abi,
        this.config.contracts.staking.address
      );
      
      console.log('🔄 Staking ↔ Trading Rewards:');
      // Note: Esta verificação depende de ter uma função que retorna o endereço do trading rewards contract
      
      // Verificar se Trading Rewards conhece o Router
      const rewardsContract = new ContractPromise(
        asContractApi(this.api),
        this.config.contracts.rewards.abi,
        this.config.contracts.rewards.address
      );
      
      console.log('🔄 Trading Rewards ↔ Router:');
      const authorizedRouter = await this.queryContract(rewardsContract, 'authorizedRouter', []);
      console.log(`   🛣️  Router autorizado: ${authorizedRouter}`);
      
      if (authorizedRouter !== this.config.contracts.router.address) {
        console.log(`   ❌ Router não autorizado! Esperado: ${this.config.contracts.router.address}`);
        allIntegrated = false;
      } else {
        console.log(`   ✅ Router autorizado corretamente`);
      }
      
    } catch (error) {
      console.log(`   ❌ Erro na verificação de integrações: ${error}`);
      allIntegrated = false;
    }
    
    console.log('');
    return allIntegrated;
  }

  private async verifyPermissions(): Promise<boolean> {
    console.log('🔐 4. Verificando permissões e segurança...\n');
    
    let allSecure = true;
    
    try {
      // Verificar se contratos não estão pausados (quando aplicável)
      console.log('▶️  Status de pausa dos contratos:');
      
      const stakingContract = new ContractPromise(
        asContractApi(this.api),
        this.config.contracts.staking.abi,
        this.config.contracts.staking.address
      );
      
      const isPaused = await this.queryContract(stakingContract, 'isPaused', []);
      console.log(`   🥩 Staking pausado: ${isPaused}`);
      
      if (isPaused) {
        console.log(`   ⚠️  Staking está pausado - isto pode ser intencional`);
      }
      
    } catch (error) {
      console.log(`   ❌ Erro na verificação de permissões: ${error}`);
      allSecure = false;
    }
    
    console.log('');
    return allSecure;
  }

  private async verifyBasicFunctionality(): Promise<boolean> {
    console.log('🧪 5. Verificando funcionalidades básicas...\n');
    
    let allFunctional = true;
    
    try {
      // Verificar informações básicas dos contratos
      console.log('📊 Informações dos contratos:');
      
      // Factory
      const factoryContract = new ContractPromise(
        asContractApi(this.api),
        this.config.contracts.factory.abi,
        this.config.contracts.factory.address
      );
      
      const allPairsLength = await this.queryContract(factoryContract, 'allPairsLength', []);
      console.log(`   🏭 Factory - Total de pares: ${allPairsLength}`);
      
      // Staking
      const stakingContract = new ContractPromise(
        asContractApi(this.api),
        this.config.contracts.staking.abi,
        this.config.contracts.staking.address
      );
      
      const stakingStats = await this.queryContract(stakingContract, 'getContractStats', []);
      console.log(`   🥩 Staking - Stats: ${JSON.stringify(stakingStats)}`);
      
      // Trading Rewards
      const rewardsContract = new ContractPromise(
        asContractApi(this.api),
        this.config.contracts.rewards.abi,
        this.config.contracts.rewards.address
      );
      
      const rewardsStats = await this.queryContract(rewardsContract, 'getStats', []);
      console.log(`   🎁 Trading Rewards - Stats: ${JSON.stringify(rewardsStats)}`);
      
    } catch (error) {
      console.log(`   ❌ Erro na verificação de funcionalidades: ${error}`);
      allFunctional = false;
    }
    
    console.log('');
    return allFunctional;
  }

  private async queryContract(contract: ContractPromise, method: string, args: any[]): Promise<any> {
    const gasLimit = this.api.registry.createType('WeightV2', {
      refTime: 1000000000000,
      proofSize: 1000000,
    }) as any;
    
    const { result, output } = await contract.query[method](
      '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', // Alice account for queries
      { gasLimit, storageDepositLimit: null },
      ...args
    );
    
    if (result.isOk && output) {
      return output.toHuman();
    }
    
    throw new Error(`Query failed: ${result.asErr || 'Unknown error'}`);
  }
}

// === FUNÇÃO PRINCIPAL ===

async function main() {
  const network = process.argv[2] || 'testnet';
  
  console.log('🚀 === LUNEX DEX - VERIFICAÇÃO DE DEPLOYMENT ===\n');
  console.log(`🌐 Rede: ${network}`);
  console.log(`⏰ Data: ${new Date().toISOString()}`);
  console.log('');
  
  try {
    // Conectar à rede
    const api = await connectToNetwork(network);
    
    // Carregar configuração
    const config = loadDeploymentConfig(network);
    console.log(`📋 Configuração carregada: ${config.contracts ? Object.keys(config.contracts).length : 0} contratos`);
    
    // Carregar ABIs
    for (const [name, info] of Object.entries(config.contracts)) {
      try {
        const abi = loadContractABI(name);
        info.abi = abi;
        console.log(`📄 ABI carregada: ${name}`);
      } catch (error) {
        console.warn(`⚠️  Não foi possível carregar ABI para ${name}: ${error}`);
      }
    }
    
    console.log('');
    
    // Executar verificação
    const verifier = new DeploymentVerifier(api, config);
    const success = await verifier.verifyAll();
    
    await api.disconnect();
    
    process.exit(success ? 0 : 1);
    
  } catch (error) {
    console.error(`💥 Erro fatal: ${error}`);
    process.exit(1);
  }
}

// === EXECUÇÃO ===

if (require.main === module) {
  main().catch(console.error);
}

export { DeploymentVerifier, main };