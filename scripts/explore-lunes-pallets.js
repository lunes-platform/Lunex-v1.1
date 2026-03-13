#!/usr/bin/env node
/**
 * 🔍 Explorar Pallets e Módulos da Lunes Blockchain
 */

const WebSocket = require('ws');
const { xxhashAsHex } = require('@polkadot/util-crypto');

async function main() {
    const ws = new WebSocket('wss://ws.lunes.io');

    ws.on('open', () => {
        console.log('✅ Conectado!\n');

        // Buscar runtime version
        ws.send(JSON.stringify({
            jsonrpc: '2.0', id: 1,
            method: 'state_getRuntimeVersion',
            params: []
        }));
    });

    let metadataReceived = false;

    ws.on('message', (data) => {
        const response = JSON.parse(data.toString());

        if (response.id === 1 && response.result) {
            console.log('📊 RUNTIME VERSION');
            console.log('==================');
            console.log(`   Spec Name: ${response.result.specName}`);
            console.log(`   Spec Version: ${response.result.specVersion}`);
            console.log(`   Impl Name: ${response.result.implName}`);
            console.log(`   Impl Version: ${response.result.implVersion}`);
            console.log(`   APIs: ${JSON.stringify(response.result.apis?.length || 0)} disponíveis`);

            // Agora buscar metadata
            ws.send(JSON.stringify({
                jsonrpc: '2.0', id: 2,
                method: 'state_getMetadata',
                params: []
            }));
        }

        if (response.id === 2 && response.result && !metadataReceived) {
            metadataReceived = true;
            console.log('\n📦 METADATA (análise parcial)');
            console.log('=============================');

            // O metadata é muito grande, vamos analisar os primeiros bytes
            const metadataHex = response.result;
            console.log(`   Tamanho: ${metadataHex.length / 2} bytes`);

            // Buscar pallets conhecidos no metadata (procurar strings)
            const knownPallets = [
                'System', 'Timestamp', 'Balances', 'Assets', 'Contracts',
                'TransactionPayment', 'Sudo', 'Scheduler', 'Democracy',
                'Council', 'Treasury', 'Staking', 'Session', 'Grandpa',
                'Babe', 'ImOnline', 'AuthorityDiscovery', 'Offences',
                'RandomnessCollectiveFlip', 'Utility', 'Multisig', 'Proxy'
            ];

            console.log('\n🔍 Pallets detectados no runtime:');
            knownPallets.forEach(pallet => {
                // Converter para hex e procurar no metadata
                const palletHex = Buffer.from(pallet).toString('hex');
                if (metadataHex.toLowerCase().includes(palletHex.toLowerCase())) {
                    console.log(`   ✅ ${pallet}`);
                }
            });

            // Verificar se tem pallet de Contracts (para smart contracts ink!)
            if (metadataHex.toLowerCase().includes(Buffer.from('Contracts').toString('hex').toLowerCase())) {
                console.log('\n🎯 PALLET CONTRACTS DETECTADO!');
                console.log('   → Smart contracts ink! são suportados');
                console.log('   → Tokens PSP22 podem ser deployados');
            }

            // Verificar se tem pallet de Assets (para tokens nativos)
            if (metadataHex.toLowerCase().includes(Buffer.from('Assets').toString('hex').toLowerCase())) {
                console.log('\n🎯 PALLET ASSETS DETECTADO!');
                console.log('   → Assets nativos são suportados');
                console.log('   → Tokens podem ser criados nativamente');
            }

            ws.close();
        }
    });

    ws.on('error', (e) => console.error('Erro:', e.message));
}

main();
