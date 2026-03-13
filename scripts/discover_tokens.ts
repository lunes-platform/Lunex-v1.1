/**
 * Discover all PSP22 token contracts on the local Lunes node
 * Queries token_name() and token_symbol() on every deployed contract
 */
import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { ContractPromise } from '@polkadot/api-contract'
import * as fs from 'fs'
import * as path from 'path'

const WS_URL = 'ws://127.0.0.1:9944'

// Load real PSP22 ABI
const PSP22_ABI = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'target/ink/psp22_token/psp22_token.json'), 'utf8')
)

async function main() {
    console.log('Connecting to local node...')
    const wsProvider = new WsProvider(WS_URL)
    const api = await ApiPromise.create({ provider: wsProvider })
    const keyring = new Keyring({ type: 'sr25519' })
    const alice = keyring.addFromUri('//Alice')

    // Get all contract addresses from storage
    console.log('Scanning all contracts on chain...\n')
    const entries = await (api.query as any).contracts.contractInfoOf.entries()

    console.log(`Found ${entries.length} contracts\n`)
    console.log('='.repeat(90))
    console.log('ADDRESS'.padEnd(52) + 'SYMBOL'.padEnd(12) + 'NAME')
    console.log('='.repeat(90))

    const tokens: { address: string; symbol: string; name: string; decimals: number }[] = []

    for (const [key] of entries) {
        const address = key.args[0].toString()

        try {
            const contract = new ContractPromise(api as any, PSP22_ABI, address)
            const gasLimit = api.registry.createType('WeightV2', {
                refTime: BigInt('50000000000'),
                proofSize: BigInt('200000'),
            }) as any

            // Query token_symbol
            const { result: symResult, output: symOutput } = await contract.query.tokenSymbol(
                alice.address,
                { gasLimit }
            )

            if (symResult.isErr) continue

            const symbol = symOutput ? (symOutput as any).toHuman()?.Ok || '' : ''
            if (!symbol) continue

            // Query token_name
            const { output: nameOutput } = await contract.query.tokenName(
                alice.address,
                { gasLimit }
            )
            const name = nameOutput ? (nameOutput as any).toHuman()?.Ok || '' : ''

            // Query token_decimals
            const { output: decOutput } = await contract.query.tokenDecimals(
                alice.address,
                { gasLimit }
            )
            const decimals = decOutput ? Number((decOutput as any).toHuman()?.Ok || '0') : 0

            // Query total_supply
            const { output: supplyOutput } = await contract.query.totalSupply(
                alice.address,
                { gasLimit }
            )
            const totalSupply = supplyOutput ? (supplyOutput as any).toHuman()?.Ok || '0' : '0'

            console.log(`${address.padEnd(52)}${String(symbol).padEnd(12)}${name} (${decimals} dec, supply: ${totalSupply})`)
            tokens.push({ address, symbol: String(symbol), name: String(name), decimals })
        } catch {
            // Not a PSP22 token — skip silently
        }
    }

    console.log('='.repeat(90))
    console.log(`\nFound ${tokens.length} PSP22 tokens total\n`)

    // Output env-friendly format
    if (tokens.length > 0) {
        console.log('# .env format:')
        for (const t of tokens) {
            const envKey = t.symbol.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_ADDRESS'
            console.log(`${envKey}=${t.address}`)
        }
    }

    await api.disconnect()
    process.exit(0)
}

main().catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
})
