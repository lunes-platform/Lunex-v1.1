/**
 * Debug: try to query token info from first few contracts, with verbose output
 */
import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { ContractPromise } from '@polkadot/api-contract'
import * as fs from 'fs'
import * as path from 'path'

const WS_URL = 'ws://127.0.0.1:9944'

// Try both ABIs
const PSP22_ABI = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'target/ink/psp22_token/psp22_token.json'), 'utf8')
)

// Also try wnative ABI
let WNATIVE_ABI: any = null
try {
    WNATIVE_ABI = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, '..', 'target/ink/wnative_contract/wnative_contract.json'), 'utf8')
    )
} catch { /* ignore */ }

async function main() {
    const wsProvider = new WsProvider(WS_URL)
    const api = await ApiPromise.create({ provider: wsProvider })
    const keyring = new Keyring({ type: 'sr25519' })
    const alice = keyring.addFromUri('//Alice')

    const entries = await (api.query as any).contracts.contractInfoOf.entries()
    console.log(`Found ${entries.length} contracts. Testing first 10...\n`)

    const gasLimit = api.registry.createType('WeightV2', {
        refTime: BigInt('50000000000'),
        proofSize: BigInt('200000'),
    }) as any

    for (let i = 0; i < Math.min(entries.length, 10); i++) {
        const address = entries[i][0].args[0].toString()
        console.log(`\n--- Contract #${i + 1}: ${address} ---`)

        try {
            const contract = new ContractPromise(api as any, PSP22_ABI, address)

            // List available messages
            const msgNames = contract.abi.messages.map((m: any) => m.method)
            console.log(`  ABI methods: ${msgNames.join(', ')}`)

            // Try each method
            for (const method of ['tokenSymbol', 'tokenName', 'totalSupply']) {
                try {
                    const { result, output } = await contract.query[method](
                        alice.address,
                        { gasLimit }
                    )
                    if (result.isOk) {
                        const human = output ? (output as any).toHuman() : null
                        const json = output ? (output as any).toJSON() : null
                        console.log(`  ${method}: OK -> human=${JSON.stringify(human)} json=${JSON.stringify(json)}`)
                    } else {
                        const errJson = result.asErr.toJSON()
                        console.log(`  ${method}: ERR -> ${JSON.stringify(errJson)}`)
                    }
                } catch (e: any) {
                    console.log(`  ${method}: EXCEPTION -> ${e.message?.substring(0, 80)}`)
                }
            }
        } catch (e: any) {
            console.log(`  Failed to instantiate: ${e.message?.substring(0, 100)}`)
        }
    }

    await api.disconnect()
    process.exit(0)
}

main().catch(err => {
    console.error('Fatal:', err)
    process.exit(1)
})
