#!/usr/bin/env ts-node

/**
 * 🔧 LUNEX DEX - ADMIN TOKEN LISTING TOOL
 * 
 * Script para listar tokens diretamente via função de admin
 * Usado para tokens iniciais e casos especiais (sem governança)
 */

import { ApiPromise, WsProvider, Keyring } from '@polkadot/api';
import { ContractPromise } from '@polkadot/api-contract';
import { BN } from '@polkadot/util';
import * as fs from 'fs';

type ContractApi = ConstructorParameters<typeof ContractPromise>[0];

function asContractApi(api: ApiPromise): ContractApi {
  return api as unknown as ContractApi;
}

// 🌐 REDES DISPONÍVEIS
const NETWORKS = {
  testnet: 'wss://ws-test.lunes.io',
  mainnet: 'wss://ws.lunes.io'
};

// 🎯 TIPOS
interface AdminConfig {
  network: 'testnet' | 'mainnet';
  adminSeed: string;
  stakingContract: string;
  tokens?: Array<{
    address: string;
    reason: string;
  }>;
}

class AdminTokenLister {
  private api!: ApiPromise;
  private keyring: Keyring;
  private adminAccount: any;
  private stakingContract!: ContractPromise;

  constructor(private config: AdminConfig) {
    this.keyring = new Keyring({ type: 'sr25519' });
    this.adminAccount = this.keyring.addFromUri(config.adminSeed);
  }

  /**
   * 🚀 Inicializar conexão
   */
  async initialize(): Promise<void> {
    console.log(`🌐 Conectando à ${this.config.network}...`);
    
    const provider = new WsProvider(NETWORKS[this.config.network]);
    this.api = await ApiPromise.create({ provider });
    await this.api.isReady;
    
    // Carregar metadata do contrato de staking
    const stakingMetadata = this.loadContractMetadata('./deployments/staking-metadata.json');
    this.stakingContract = new ContractPromise(asContractApi(this.api), stakingMetadata, this.config.stakingContract);
    
    console.log(`✅ Conectado à ${this.config.network}`);
    console.log(`👤 Admin: ${this.adminAccount.address}`);
    console.log(`📋 Staking Contract: ${this.config.stakingContract}`);
  }

  /**
   * 📋 Listar token individual
   */
  async listSingleToken(tokenAddress: string, reason: string): Promise<void> {
    console.log(`📋 Listando token: ${tokenAddress}`);
    console.log(`💭 Razão: ${reason}`);

    // Verificar se já está listado
    const isAlreadyListed = await this.stakingContract.query.isProjectApproved(
      this.adminAccount.address,
      {},
      tokenAddress
    );

    if (isAlreadyListed.output?.toJSON()) {
      console.log(`⚠️ Token já está listado!`);
      return;
    }

    // Listar o token
    const tx = this.stakingContract.tx.adminListToken(
      {
        gasLimit: new BN('200000000000'), // 2,000 LUNES
      },
      tokenAddress,
      reason
    );

    await this.signAndWaitForFinalization(tx, 'adminListToken');
    console.log(`✅ Token listado com sucesso!`);
  }

  /**
   * 📦 Listar múltiplos tokens (batch)
   */
  async listBatchTokens(tokens: Array<{address: string, reason: string}>): Promise<void> {
    console.log(`📦 Listando ${tokens.length} tokens em batch...`);

    if (tokens.length > 50) {
      throw new Error('❌ Máximo 50 tokens por batch');
    }

    // Filtrar tokens já listados
    const tokensToList = [];
    for (const token of tokens) {
      const isAlreadyListed = await this.stakingContract.query.isProjectApproved(
        this.adminAccount.address,
        {},
        token.address
      );

      if (!isAlreadyListed.output?.toJSON()) {
        tokensToList.push([token.address, token.reason]);
        console.log(`📋 ${token.address} - ${token.reason}`);
      } else {
        console.log(`⏭️ ${token.address} - já listado, pulando...`);
      }
    }

    if (tokensToList.length === 0) {
      console.log(`ℹ️ Todos os tokens já estão listados!`);
      return;
    }

    // Executar batch listing
    const tx = this.stakingContract.tx.adminBatchListTokens(
      {
        gasLimit: new BN('500000000000'), // 5,000 LUNES
      },
      tokensToList
    );

    await this.signAndWaitForFinalization(tx, 'adminBatchListTokens');
    console.log(`✅ ${tokensToList.length} tokens listados com sucesso!`);
  }

  /**
   * 🗑️ Remover token (delist)
   */
  async delistToken(tokenAddress: string, reason: string): Promise<void> {
    console.log(`🗑️ Removendo token: ${tokenAddress}`);
    console.log(`💭 Razão: ${reason}`);

    // Verificar se está listado
    const isListed = await this.stakingContract.query.isProjectApproved(
      this.adminAccount.address,
      {},
      tokenAddress
    );

    if (!isListed.output?.toJSON()) {
      console.log(`⚠️ Token não está listado!`);
      return;
    }

    // Remover o token
    const tx = this.stakingContract.tx.adminDelistToken(
      {
        gasLimit: new BN('200000000000'), // 2,000 LUNES
      },
      tokenAddress,
      reason
    );

    await this.signAndWaitForFinalization(tx, 'adminDelistToken');
    console.log(`✅ Token removido com sucesso!`);
  }

  /**
   * 📊 Verificar status de token
   */
  async checkTokenStatus(tokenAddress: string): Promise<void> {
    console.log(`🔍 Verificando status do token: ${tokenAddress}`);

    const isListed = await this.stakingContract.query.isProjectApproved(
      this.adminAccount.address,
      {},
      tokenAddress
    );

    if (isListed.output?.toJSON()) {
      console.log(`✅ Token está LISTADO`);
    } else {
      console.log(`❌ Token NÃO está listado`);
    }
  }

  /**
   * 📈 Obter estatísticas
   */
  async getListingStats(): Promise<void> {
    console.log(`📈 Obtendo estatísticas de listagem...`);

    const stats = await this.stakingContract.query.getListingStats(
      this.adminAccount.address,
      {}
    );

    if (stats.output) {
      const [proposalsCreated, stakersAtivos, tokensAprovados] = stats.output.toJSON() as [number, number, number];
      
      console.log(`📊 Estatísticas:`);
      console.log(`   📋 Propostas criadas: ${proposalsCreated}`);
      console.log(`   👥 Stakers ativos: ${stakersAtivos}`);
      console.log(`   💎 Tokens aprovados: ${tokensAprovados} (calculado off-chain)`);
    }
  }

  // ===============================
  // FUNÇÕES AUXILIARES
  // ===============================

  private loadContractMetadata(path: string): any {
    if (!fs.existsSync(path)) {
      throw new Error(`❌ Metadata não encontrada: ${path}`);
    }
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  }

  private async signAndWaitForFinalization(tx: any, operation: string): Promise<void> {
    return new Promise((resolve, reject) => {
      tx.signAndSend(this.adminAccount, ({ status, dispatchError }: any) => {
        if (status.isInBlock) {
          console.log(`📋 ${operation} incluído no bloco`);
        } else if (status.isFinalized) {
          if (dispatchError) {
            reject(new Error(`❌ ${operation} falhou: ${dispatchError.toString()}`));
          } else {
            console.log(`✅ ${operation} finalizado com sucesso`);
            resolve();
          }
        }
      }).catch(reject);
    });
  }
}

// 🎯 COMANDOS PRINCIPAIS
async function main() {
  const command = process.argv[2];
  
  if (!command) {
    console.log(`
🔧 LUNEX DEX ADMIN TOKEN LISTING TOOL

Comandos disponíveis:

  list <config.json>                  - Listar token(s) via arquivo de configuração
  list-single <token> <reason>        - Listar um token específico
  delist <token> <reason>             - Remover token da lista  
  check <token>                       - Verificar se token está listado
  stats                               - Obter estatísticas de listagem

Exemplos de uso:

  # Listar tokens via configuração
  npm run admin-list-token list examples/admin-tokens.json
  
  # Listar token individual
  npm run admin-list-token list-single 5GHU...TOKEN_ADDRESS "USDT Stablecoin"
  
  # Remover token problemático
  npm run admin-list-token delist 5BAD...TOKEN_ADDRESS "Token com problemas de segurança"
  
  # Verificar status
  npm run admin-list-token check 5GHU...TOKEN_ADDRESS

Exemplo de config.json:
{
  "network": "testnet",
  "adminSeed": "//Alice",
  "stakingContract": "5GHU...STAKING_ADDRESS",
  "tokens": [
    {
      "address": "5ABC...TOKEN1", 
      "reason": "USDT - Stablecoin principal"
    },
    {
      "address": "5DEF...TOKEN2",
      "reason": "WBTC - Bitcoin wrapeado"
    }
  ]
}
    `);
    process.exit(1);
  }

  try {
    switch (command) {
      case 'list':
        const configPath = process.argv[3];
        if (!configPath) {
          console.error('❌ Especifique o arquivo de configuração');
          process.exit(1);
        }
        
        const config: AdminConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const lister = new AdminTokenLister(config);
        await lister.initialize();
        
        if (config.tokens && config.tokens.length > 0) {
          if (config.tokens.length === 1) {
            await lister.listSingleToken(config.tokens[0].address, config.tokens[0].reason);
          } else {
            await lister.listBatchTokens(config.tokens);
          }
        } else {
          console.error('❌ Nenhum token especificado no arquivo de configuração');
        }
        break;

      case 'list-single':
        const tokenAddress = process.argv[3];
        const reason = process.argv[4];
        if (!tokenAddress || !reason) {
          console.error('❌ Uso: npm run admin-list-token list-single <token_address> <reason>');
          process.exit(1);
        }
        
        // Implementar com config mínimo
        console.log('🔧 Para implementar: criar config e executar listSingleToken');
        break;

      case 'delist':
        console.log('🗑️ Comando delist - implementar similar ao list-single');
        break;

      case 'check':
        console.log('🔍 Comando check - implementar similar ao list-single');
        break;

      case 'stats':
        console.log('📈 Comando stats - implementar similar ao list-single');
        break;

      default:
        console.error(`❌ Comando inválido: ${command}`);
        process.exit(1);
    }
  } catch (error) {
    console.error('💥 Erro:', error);
    process.exit(1);
  }
}

// 🚀 EXECUTAR
if (require.main === module) {
  main();
}

export { AdminTokenLister, AdminConfig };