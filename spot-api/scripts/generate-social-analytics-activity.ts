import { ApiPromise, Keyring, WsProvider } from '@polkadot/api'
import { ContractPromise } from '@polkadot/api-contract'
import { readFileSync } from 'fs'
import { join } from 'path'

type DeployedAddresses = {
  wnative: string
  lusdt: string
  factory: string
  router: string
  pairWlunesLusdt?: string
}

const WS_URL = process.env.BLOCKCHAIN_WS_URL || 'ws://127.0.0.1:9944'
const ARTIFACTS_DIR = join(__dirname, '../../target/ink')
const DEPLOYED_ADDRESSES_PATH = join(__dirname, '../deployed-addresses.json')
const ZERO_ADDRESS = '5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuYmJFpN'

function log(message: string) {
  console.log(message)
}

function loadJson(filePath: string) {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function loadAbi(contractName: string) {
  return loadJson(join(ARTIFACTS_DIR, contractName, `${contractName}.json`))
}

function makeGas(api: ApiPromise) {
  return api.registry.createType('WeightV2', {
    refTime: 300_000_000_000n,
    proofSize: 10_000_000n,
  }) as any
}

function makeDryGas(api: ApiPromise) {
  return api.registry.createType('WeightV2', {
    refTime: 50_000_000_000n,
    proofSize: 1_000_000n,
  }) as any
}

function unwrapValue(value: any): any {
  if (value && typeof value === 'object' && 'ok' in value && Object.keys(value).length === 1) {
    return unwrapValue(value.ok)
  }

  if (Array.isArray(value)) {
    return value.map((entry) => unwrapValue(entry))
  }

  return value
}

function toBigIntValue(value: unknown): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return BigInt(Math.trunc(value))
  if (typeof value === 'string') return BigInt(value)
  if (value && typeof value === 'object' && 'toString' in value) {
    return BigInt((value as { toString(): string }).toString())
  }
  return 0n
}

function collectBigIntValues(value: unknown): bigint[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectBigIntValues(entry))
  }

  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((entry) => collectBigIntValues(entry))
  }

  try {
    return [toBigIntValue(value)]
  } catch {
    return []
  }
}

async function query(api: ApiPromise, caller: { address: string }, contract: ContractPromise, method: string, args: any[] = []) {
  const gas = makeDryGas(api)
  const { result, output } = await (contract.query as any)[method](caller.address, { gasLimit: gas }, ...args)
  if (result.isErr) {
    throw new Error(`query ${method}: ${result.asErr.toString()}`)
  }
  return unwrapValue(output?.toJSON())
}

async function sendTx(label: string, tx: any, signer: any) {
  await new Promise<void>((resolve, reject) => {
    let unsub: (() => void) | null = null

    tx.signAndSend(signer, (result: any) => {
      const { status, dispatchError } = result

      if (dispatchError) {
        const errorMessage = dispatchError.isModule
          ? dispatchError.asModule.toString()
          : dispatchError.toString()
        if (unsub) unsub()
        reject(new Error(`${label}: ${errorMessage}`))
        return
      }

      if (status.isInBlock || status.isFinalized) {
        if (unsub) unsub()
        resolve()
      }
    }).then((callback: () => void) => {
      unsub = callback
    }).catch(reject)
  })

  log(`  ok ${label}`)
}

async function main() {
  const deployedAddresses = loadJson(DEPLOYED_ADDRESSES_PATH) as DeployedAddresses

  if (!deployedAddresses.wnative || !deployedAddresses.lusdt || !deployedAddresses.factory || !deployedAddresses.router) {
    throw new Error('Missing required deployed addresses in spot-api/deployed-addresses.json')
  }

  const provider = new WsProvider(WS_URL)
  const api = await ApiPromise.create({ provider })
  await api.isReady

  const keyring = new Keyring({ type: 'sr25519' })
  const alice = keyring.addFromUri('//Alice')
  const bob = keyring.addFromUri('//Bob')
  const eve = keyring.addFromUri('//Eve')

  const wnativeAbi = loadAbi('wnative_contract')
  const factoryAbi = loadAbi('factory_contract')
  const routerAbi = loadAbi('router_contract')
  const pairAbi = loadAbi('pair_contract')

  const wlunes = new ContractPromise(api, wnativeAbi, deployedAddresses.wnative)
  const lusdt = new ContractPromise(api, wnativeAbi, deployedAddresses.lusdt)
  const factory = new ContractPromise(api, factoryAbi, deployedAddresses.factory)
  const router = new ContractPromise(api, routerAbi, deployedAddresses.router)
  const gas = makeGas(api)

  const pairFromFactory = await query(api, alice, factory, 'getPair', [deployedAddresses.wnative, deployedAddresses.lusdt])
  const pairAddress = typeof pairFromFactory === 'string' && pairFromFactory !== ZERO_ADDRESS
    ? pairFromFactory
    : deployedAddresses.pairWlunesLusdt

  if (!pairAddress || pairAddress === ZERO_ADDRESS) {
    throw new Error('WLUNES/LUSDT pair not found. Run the local token setup first.')
  }

  const pair = new ContractPromise(api, pairAbi, pairAddress)
  const deadline = BigInt(Date.now() + 60 * 60 * 1000)
  const largeAllowance = 1_000_000_000_000_000n
  const reservesBefore = await query(api, alice, pair, 'getReserves', [])
  const pairHasLiquidity = collectBigIntValues(reservesBefore).some((value) => value > 0n)

  log('Generating social analytics activity for Alice, Bob and Eve')
  log(`  Alice   ${alice.address}`)
  log(`  Bob     ${bob.address}`)
  log(`  Eve     ${eve.address}`)
  log(`  Pair    ${pairAddress}`)
  log(`  Reserves ${JSON.stringify(reservesBefore)}`)

  await sendTx(
    'Alice deposit WLUNES',
    (wlunes.tx as any).deposit({ gasLimit: gas, value: 30_000_000_000n, storageDepositLimit: null }),
    alice,
  )

  await sendTx(
    'Alice approve WLUNES',
    (wlunes.tx as any).approve({ gasLimit: gas, storageDepositLimit: null }, deployedAddresses.router, largeAllowance),
    alice,
  )

  await sendTx(
    'Alice approve LUSDT',
    (lusdt.tx as any).approve({ gasLimit: gas, storageDepositLimit: null }, deployedAddresses.router, largeAllowance),
    alice,
  )

  if (!pairHasLiquidity) {
    await sendTx(
      'Alice add liquidity',
      (router.tx as any).addLiquidity(
        { gasLimit: gas, storageDepositLimit: null },
        deployedAddresses.wnative,
        deployedAddresses.lusdt,
        5_000_000_000n,
        12_500_000_000n,
        0n,
        0n,
        alice.address,
        deadline,
      ),
      alice,
    )
  } else {
    log('  skipping add liquidity because pair already has reserves')
  }

  await sendTx(
    'Bob deposit WLUNES',
    (wlunes.tx as any).deposit({ gasLimit: gas, value: 4_000_000_000n, storageDepositLimit: null }),
    bob,
  )

  await sendTx(
    'Bob approve WLUNES',
    (wlunes.tx as any).approve({ gasLimit: gas, storageDepositLimit: null }, deployedAddresses.router, largeAllowance),
    bob,
  )

  await sendTx(
    'Bob swap WLUNES to LUSDT',
    (router.tx as any).swapExactTokensForTokens(
      { gasLimit: gas, storageDepositLimit: null },
      1_000_000_000n,
      0n,
      [deployedAddresses.wnative, deployedAddresses.lusdt],
      bob.address,
      deadline,
    ),
    bob,
  )

  await sendTx(
    'Charlie deposit LUSDT',
    (lusdt.tx as any).transfer({ gasLimit: gas, storageDepositLimit: null }, eve.address, 4_000_000_000n, []),
    alice,
  )

  await sendTx(
    'Charlie fund native balance',
    api.tx.balances.transferKeepAlive(eve.address, 2_000_000_000n),
    alice,
  )

  await sendTx(
    'Charlie approve LUSDT',
    (lusdt.tx as any).approve({ gasLimit: gas, storageDepositLimit: null }, deployedAddresses.router, largeAllowance),
    eve,
  )

  await sendTx(
    'Charlie swap LUSDT to WLUNES',
    (router.tx as any).swapExactTokensForTokens(
      { gasLimit: gas, storageDepositLimit: null },
      2_000_000_000n,
      0n,
      [deployedAddresses.lusdt, deployedAddresses.wnative],
      eve.address,
      deadline,
    ),
    eve,
  )

  const charlieWlunesBalance = toBigIntValue(await query(api, eve, wlunes, 'balanceOf', [eve.address]))
  const withdrawAmount = charlieWlunesBalance > 50_000_000n ? 50_000_000n : charlieWlunesBalance / 10n

  if (withdrawAmount > 0n) {
    await sendTx(
      'Charlie withdraw WLUNES',
      (wlunes.tx as any).withdraw({ gasLimit: gas, storageDepositLimit: null }, withdrawAmount),
      eve,
    )
  }

  const [aliceLp, bobLusdt, charlieWlunes, reserves] = await Promise.all([
    query(api, alice, pair, 'balanceOf', [alice.address]),
    query(api, bob, lusdt, 'balanceOf', [bob.address]),
    query(api, eve, wlunes, 'balanceOf', [eve.address]),
    query(api, alice, pair, 'getReserves', []),
  ])

  log('Final balances')
  log(`  Alice LP       ${JSON.stringify(aliceLp)}`)
  log(`  Bob LUSDT      ${JSON.stringify(bobLusdt)}`)
  log(`  Charlie WLUNES ${JSON.stringify(charlieWlunes)}`)
  log(`  Pair reserves  ${JSON.stringify(reserves)}`)

  await api.disconnect()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
