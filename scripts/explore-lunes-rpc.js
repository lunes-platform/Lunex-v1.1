#!/usr/bin/env node
/**
 * 🔍 Explorador de RPC da Lunes Blockchain
 * Conecta aos nodes e descobre métodos disponíveis para assets nativos
 */

const WebSocket = require('ws');

const LUNES_ENDPOINTS = [
    'wss://ws.lunes.io',
    'wss://ws-lunes-main-01.lunes.io',
    'wss://ws-lunes-main-02.lunes.io',
    'wss://ws-archive.lunes.io'
];

// Métodos RPC para explorar (baseado em Substrate/Polkadot)
const RPC_METHODS_TO_TEST = [
    // Métodos de sistema
    { method: 'system_chain', params: [], desc: 'Nome da chain' },
    { method: 'system_name', params: [], desc: 'Nome do node' },
    { method: 'system_version', params: [], desc: 'Versão do node' },
    { method: 'system_health', params: [], desc: 'Health do node' },
    { method: 'system_properties', params: [], desc: 'Propriedades da chain' },
    { method: 'rpc_methods', params: [], desc: 'Lista todos os métodos RPC disponíveis' },

    // Métodos de estado
    { method: 'state_getRuntimeVersion', params: [], desc: 'Versão do runtime' },
    { method: 'state_getMetadata', params: [], desc: 'Metadata do runtime (pallets disponíveis)' },

    // Métodos de assets (se disponíveis)
    { method: 'assets_listAssets', params: [], desc: 'Lista assets nativos' },

    // Chain info
    { method: 'chain_getBlockHash', params: [0], desc: 'Hash do bloco genesis' },
    { method: 'chain_getFinalizedHead', params: [], desc: 'Último bloco finalizado' },
];

async function testEndpoint(url) {
    return new Promise((resolve) => {
        console.log(`\n🔗 Conectando a: ${url}`);

        const ws = new WebSocket(url);
        const results = { url, connected: false, methods: {}, error: null };
        let messageId = 1;
        let pendingRequests = {};
        let completedCount = 0;

        const timeout = setTimeout(() => {
            console.log(`   ⏱️ Timeout atingido`);
            ws.close();
            resolve(results);
        }, 15000);

        ws.on('open', () => {
            console.log(`   ✅ Conectado!`);
            results.connected = true;

            // Enviar todas as requisições
            RPC_METHODS_TO_TEST.forEach(({ method, params, desc }) => {
                const id = messageId++;
                pendingRequests[id] = { method, desc };

                ws.send(JSON.stringify({
                    jsonrpc: '2.0',
                    id,
                    method,
                    params
                }));
            });
        });

        ws.on('message', (data) => {
            try {
                const response = JSON.parse(data.toString());
                const request = pendingRequests[response.id];

                if (request) {
                    if (response.result !== undefined) {
                        results.methods[request.method] = {
                            available: true,
                            desc: request.desc,
                            sample: typeof response.result === 'string'
                                ? response.result.substring(0, 200)
                                : JSON.stringify(response.result).substring(0, 200)
                        };
                        console.log(`   ✅ ${request.method}: OK`);
                    } else if (response.error) {
                        results.methods[request.method] = {
                            available: false,
                            desc: request.desc,
                            error: response.error.message
                        };
                        console.log(`   ❌ ${request.method}: ${response.error.message}`);
                    }

                    completedCount++;
                    if (completedCount >= RPC_METHODS_TO_TEST.length) {
                        clearTimeout(timeout);
                        ws.close();
                        resolve(results);
                    }
                }
            } catch (e) {
                // Ignorar mensagens não-JSON (subscriptions, etc)
            }
        });

        ws.on('error', (error) => {
            console.log(`   ❌ Erro: ${error.message}`);
            results.error = error.message;
            clearTimeout(timeout);
            resolve(results);
        });

        ws.on('close', () => {
            clearTimeout(timeout);
            resolve(results);
        });
    });
}

async function main() {
    console.log('🔍 EXPLORADOR DE RPC - LUNES BLOCKCHAIN');
    console.log('=========================================\n');

    const allResults = [];

    for (const endpoint of LUNES_ENDPOINTS) {
        const result = await testEndpoint(endpoint);
        allResults.push(result);
    }

    // Resumo
    console.log('\n\n📊 RESUMO DOS ENDPOINTS');
    console.log('========================\n');

    allResults.forEach(r => {
        console.log(`\n📡 ${r.url}`);
        console.log(`   Conectado: ${r.connected ? '✅' : '❌'}`);

        if (r.connected) {
            const available = Object.values(r.methods).filter(m => m.available).length;
            console.log(`   Métodos disponíveis: ${available}/${Object.keys(r.methods).length}`);

            // Mostrar info relevante
            if (r.methods['system_chain']?.available) {
                console.log(`   Chain: ${r.methods['system_chain'].sample}`);
            }
            if (r.methods['system_version']?.available) {
                console.log(`   Versão: ${r.methods['system_version'].sample}`);
            }
            if (r.methods['system_properties']?.available) {
                console.log(`   Propriedades: ${r.methods['system_properties'].sample}`);
            }
        }
    });

    // Lista de métodos RPC disponíveis (do primeiro endpoint que funcionou)
    const workingEndpoint = allResults.find(r => r.methods['rpc_methods']?.available);
    if (workingEndpoint) {
        console.log('\n\n📋 MÉTODOS RPC DISPONÍVEIS');
        console.log('===========================');
        try {
            const methods = JSON.parse(workingEndpoint.methods['rpc_methods'].sample);
            if (methods.methods) {
                console.log('\nMétodos encontrados:');
                methods.methods.slice(0, 50).forEach(m => console.log(`   - ${m}`));
                if (methods.methods.length > 50) {
                    console.log(`   ... e mais ${methods.methods.length - 50} métodos`);
                }
            }
        } catch (e) {
            console.log('   (formato não parseable)');
        }
    }

    console.log('\n\n✅ Exploração concluída!');
}

main().catch(console.error);
