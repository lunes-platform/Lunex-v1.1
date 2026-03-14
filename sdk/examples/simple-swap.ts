/**
 * Simple Swap Example
 * 
 * This example demonstrates how to:
 * 1. Initialize the SDK
 * 2. Authenticate with wallet
 * 3. Get a swap quote
 * 4. Execute a swap with slippage protection
 */

import LunexSDK from '@lunex/sdk';
import { web3Accounts, web3Enable, web3FromSource } from '@polkadot/extension-dapp';

async function main() {
    // 1. Initialize SDK
    const sdk = new LunexSDK({
        baseURL: 'https://api-testnet.lunex.io/v1',
        wsURL: 'wss://api-testnet.lunex.io'
    });

    console.log('SDK initialized ✓');

    // 2. Authenticate with Polkadot.js wallet
    const extensions = await web3Enable('Lunex DEX Example');
    if (extensions.length === 0) {
        throw new Error('Please install Polkadot.js extension');
    }

    const accounts = await web3Accounts();
    if (accounts.length === 0) {
        throw new Error('No accounts found');
    }

    const account = accounts[0];
    console.log('Using account:', account.address);

    // Get nonce
    const { nonce } = await sdk.auth.getNonce(account.address);
    console.log('Nonce received ✓');

    // Sign nonce
    const injector = await web3FromSource(account.meta.source);
    const signRaw = injector?.signer?.signRaw;

    if (!signRaw) {
        throw new Error('Signer not available');
    }

    const { signature } = await signRaw({
        address: account.address,
        data: nonce,
        type: 'bytes'
    });

    // Login
    const { token } = await sdk.auth.login(account.address, signature, nonce);
    console.log('Authenticated ✓');

    // 3. Get swap quote
    const WLUNES = '5HWNativeAddress...';
    const USDT = '5HUSDTAddress...';
    const amountIn = '100000000000'; // 1000 LUNES (8 decimals)

    console.log('\nGetting quote...');
    const quote = await sdk.router.getQuote(amountIn, [WLUNES, USDT]);

    console.log('Quote received:');
    console.log('  Amount in:', sdk.utils.formatAmount(quote.amountIn, 8), 'WLUNES');
    console.log('  Amount out:', sdk.utils.formatAmount(quote.amountOut, 6), 'USDT');
    console.log('  Price impact:', quote.priceImpact, '%');
    console.log('  Minimum received:', sdk.utils.formatAmount(quote.minimumReceived, 6), 'USDT');
    console.log('  Fee:', sdk.utils.formatAmount(quote.fee, 8), 'WLUNES');

    // 4. Execute swap
    const slippageTolerance = 1.0; // 1%
    const deadline = sdk.utils.calculateDeadline(20); // 20 minutes

    console.log('\nExecuting swap...');
    const result = await sdk.router.swapExactTokensForTokens({
        amountIn,
        amountOutMin: quote.minimumReceived,
        path: [WLUNES, USDT],
        to: account.address,
        deadline
    });

    console.log('Swap successful! ✓');
    console.log('  Transaction hash:', result.transactionHash);
    console.log('  Block number:', result.blockNumber);
    console.log('  Gas used:', result.gasUsed);
    console.log('  Amount out:', sdk.utils.formatAmount(result.amountOut, 6), 'USDT');
    console.log('  Execution price:', result.executionPrice);
    console.log('  Price impact:', result.priceImpact, '%');
}

main()
    .then(() => {
        console.log('\nExample completed successfully!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\nError:', error.message);
        if (error.details) {
            console.error('Details:', error.details);
        }
        process.exit(1);
    });
