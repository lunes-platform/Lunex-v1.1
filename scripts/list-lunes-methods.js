#!/usr/bin/env node
/**
 * 🔍 Listar todos os métodos RPC da Lunes
 */

const WebSocket = require('ws');

async function main() {
    const ws = new WebSocket('wss://ws.lunes.io');

    ws.on('open', () => {
        console.log('✅ Conectado a wss://ws.lunes.io\n');
        ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'rpc_methods',
            params: []
        }));
    });

    ws.on('message', (data) => {
        const response = JSON.parse(data.toString());
        if (response.result && response.result.methods) {
            console.log('📋 MÉTODOS RPC DISPONÍVEIS NA LUNES BLOCKCHAIN');
            console.log('==============================================\n');

            const methods = response.result.methods.sort();

            // Agrupar por prefixo
            const groups = {};
            methods.forEach(m => {
                const prefix = m.split('_')[0];
                if (!groups[prefix]) groups[prefix] = [];
                groups[prefix].push(m);
            });

            Object.keys(groups).sort().forEach(prefix => {
                console.log(`\n📦 ${prefix.toUpperCase()} (${groups[prefix].length} métodos)`);
                console.log('─'.repeat(40));
                groups[prefix].forEach(m => console.log(`   ${m}`));
            });

            console.log(`\n\n📊 TOTAL: ${methods.length} métodos disponíveis`);

            // Destacar métodos relevantes para assets
            const assetMethods = methods.filter(m =>
                m.includes('asset') ||
                m.includes('Asset') ||
                m.includes('balance') ||
                m.includes('token') ||
                m.includes('contracts')
            );

            if (assetMethods.length > 0) {
                console.log('\n\n🎯 MÉTODOS RELEVANTES PARA ASSETS/TOKENS');
                console.log('=========================================');
                assetMethods.forEach(m => console.log(`   ✨ ${m}`));
            }
        }
        ws.close();
    });

    ws.on('error', (e) => console.error('Erro:', e.message));
}

main();
