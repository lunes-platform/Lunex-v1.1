/**
 * Transfer PSP22 tokens from Alice (deployer) to a test wallet
 * Uses the real compiled PSP22 ABI from target/ink/
 */
import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { ContractPromise } from '@polkadot/api-contract'
import BN from 'bn.js'
import * as fs from 'fs'
import * as path from 'path'

const WS_URL = process.env.LUNES_WS_URL || 'wss://sandbox.lunes.io/ws'
const RECIPIENT = '5HYVGHPrMmG6TKeczuTjhaGcRTkW8sMhWfppaFrTCAvKFfBb'

// Load real PSP22 ABI
const PSP22_ABI = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'target/ink/psp22_token/psp22_token.json'), 'utf8')
)

// PSP22 tokens — sandbox testnet addresses (from deployment/remaining-deploy-*.json)
// Switch via LUNES_NETWORK=local to use local node addresses instead
const TOKENS_SANDBOX: Record<string, { address: string; amount: string; decimals: number }> = {
    LUSDT:  { address: '5CdLQGeA89rffQrfckqB8cX3qQkMauszo7rqt5QaNYChsXsf', amount: '1000000',  decimals: 6 },  // 1M LUSDT
    WLUNES: { address: '5DqvK3iPYW3R7LK1DrS3bz5RFjxkk3ziBXmoyKTyigtFAnBL', amount: '5000000',  decimals: 8 },  // 5M WLUNES
    LBTC:   { address: '5FvT73acgKALbPEqwAdah8pY28LL5EE4fNBzCgmgjTkmdsMg', amount: '50',        decimals: 8 },  // 50 LBTC
    LETH:   { address: '5DhVzePc99qpcmmm9yA8ZzSRPuLXp8dEc8nSZmQVyczHRGNS', amount: '500',       decimals: 8 },  // 500 LETH
    GMC:    { address: '5CfB22jZ43hkK5ZPhaaVk9wefMgTnERsawE8e9urdkMNEMRJ', amount: '50000000', decimals: 8 },  // 50M GMC
    LUP:    { address: '5ELQTeXGvjijzJ7zUtTtLmm6rf44ogMnFBsT7tfYzDuzuvW3', amount: '100000000',decimals: 8 },  // 100M LUP
}

const TOKENS_LOCAL: Record<string, { address: string; amount: string; decimals: number }> = {
    LUSDT:  { address: '5CdLQGeA89rffQrfckqB8cX3qQkMauszo7rqt5QaNYChsXsf', amount: '1000000',  decimals: 6 },
    WLUNES: { address: '5HRAv1VDeWkLnmkZAjgo6oigU5179nUDBgjKX4u5wztM7tTo', amount: '5000000',  decimals: 8 },
    LBTC:   { address: '5FvT73acgKALbPEqwAdah8pY28LL5EE4fNBzCgmgjTkmdsMg', amount: '50',        decimals: 8 },
    LETH:   { address: '5DhVzePc99qpcmmm9yA8ZzSRPuLXp8dEc8nSZmQVyczHRGNS', amount: '500',       decimals: 8 },
    GMC:    { address: '5CfB22jZ43hkK5ZPhaaVk9wefMgTnERsawE8e9urdkMNEMRJ', amount: '50000000', decimals: 8 },
    LUP:    { address: '5ELQTeXGvjijzJ7zUtTtLmm6rf44ogMnFBsT7tfYzDuzuvW3', amount: '100000000',decimals: 8 },
}

const TOKENS = process.env.LUNES_NETWORK === 'local' ? TOKENS_LOCAL : TOKENS_SANDBOX

async function main() {
    console.log('Connecting to local node...')
    const wsProvider = new WsProvider(WS_URL)
    const api = await ApiPromise.create({ provider: wsProvider })

    const keyring = new Keyring({ type: 'sr25519' })
    const alice = keyring.addFromUri('//Alice')
    console.log(`Sender (Alice): ${alice.address}`)
    console.log(`Recipient: ${RECIPIENT}\n`)

    // Send native LUNES — generous amount for gas + staking + pool testing
    console.log('--- Sending 500,000 LUNES (native) ---')
    const nativeAmount = new BN('500000').mul(new BN(10).pow(new BN(12)))
    const nativeTx = api.tx.balances.transferKeepAlive(RECIPIENT, nativeAmount)
    await new Promise<void>((resolve, reject) => {
        nativeTx.signAndSend(alice, (result: any) => {
            if (result.status.isInBlock) {
                if (result.dispatchError) {
                    reject(new Error(`Native transfer failed: ${result.dispatchError.toString()}`))
                } else {
                    console.log(`  ✅ 500,000 LUNES sent (block: ${result.status.asInBlock.toHex()})`)
                    resolve()
                }
            }
        })
    })

    // Transfer each PSP22 token
    for (const [symbol, config] of Object.entries(TOKENS)) {
        const rawAmount = new BN(config.amount).mul(new BN(10).pow(new BN(config.decimals)))
        console.log(`\n--- ${symbol} ---`)
        console.log(`  Contract: ${config.address}`)
        console.log(`  Amount: ${config.amount} (${rawAmount.toString()} raw)`)

        try {
            const contract = new ContractPromise(api as any, PSP22_ABI, config.address)

            // Dry run transfer to get gas requirements
            const { gasRequired, result: dryResult } = await contract.query.transfer(
                alice.address,
                { gasLimit: api.registry.createType('WeightV2', { refTime: BigInt('50000000000'), proofSize: BigInt('200000') }) as any },
                RECIPIENT,
                rawAmount,
                []
            )

            if (dryResult.isErr) {
                console.log(`  ❌ Dry run failed: ${dryResult.asErr.toString()}`)
                continue
            }

            console.log(`  Gas: refTime=${gasRequired.refTime.toString()}, proofSize=${gasRequired.proofSize.toString()}`)

            // Execute transfer
            await new Promise<void>((resolve, reject) => {
                contract.tx.transfer(
                    { gasLimit: gasRequired },
                    RECIPIENT,
                    rawAmount,
                    []
                )
                    .signAndSend(alice, (result: any) => {
                        if (result.status.isInBlock) {
                            if (result.dispatchError) {
                                console.log(`  ❌ Transfer failed`)
                                reject(new Error('Transfer reverted'))
                            } else {
                                console.log(`  ✅ ${config.amount} ${symbol} sent (block: ${result.status.asInBlock.toHex()})`)
                                resolve()
                            }
                        }
                    })
            })
        } catch (err: any) {
            console.log(`  ❌ Error: ${err.message}`)
        }
    }

    console.log('\n🎉 All transfers complete!')
    await api.disconnect()
    process.exit(0)
}

main().catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
})
