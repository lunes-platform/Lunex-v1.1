import fs from 'fs/promises'
import path from 'path'
import { ApiPromise, WsProvider } from '@polkadot/api'
import { ContractPromise } from '@polkadot/api-contract'
import prisma from '../db'
import { config } from '../config'
import { log } from '../utils/logger'
import { subqueryClient } from './subqueryClient'

type IndexedEventKind = 'SWAP' | 'LIQUIDITY_ADD' | 'LIQUIDITY_REMOVE' | 'TRADE_OPEN' | 'TRADE_CLOSE' | 'VAULT_DEPOSIT' | 'VAULT_WITHDRAW' | 'ASYMMETRIC_SWAP' | 'UNKNOWN'
type KnownContractKind = 'router' | 'pair' | 'wnative' | 'copy_vault' | 'asymmetric_pair'
type NormalizedIndexedEvent = {
  pallet: string
  method: string
  kind: IndexedEventKind
  accountAddress: string | null
  counterpartyAddress: string | null
  pairSymbol: string | null
  amountIn: number | null
  amountOut: number | null
  price: number | null
  realizedPnl: number | null
  payload: any
}
type KnownContractDecoder = {
  kind: KnownContractKind
  contract: ContractPromise
  pairSymbol?: string | null
}

const ACCOUNT_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/
const PAIR_REGEX = /[A-Z0-9]{2,12}\/[A-Z0-9]{2,12}/
const REPO_ROOT = path.resolve(__dirname, '../../..')
const DEPLOYED_ADDRESSES_PATH = path.resolve(REPO_ROOT, 'spot-api', 'deployed-addresses.json')
const ROUTER_ABI_PATH = path.resolve(REPO_ROOT, 'lunes-dex-main', 'src', 'abis', 'Router.json')
const PAIR_ABI_PATH = path.resolve(REPO_ROOT, 'lunes-dex-main', 'src', 'abis', 'Pair.json')
const WNATIVE_ABI_PATH = path.resolve(REPO_ROOT, 'lunes-dex-main', 'src', 'abis', 'WNative.json')
const COPY_VAULT_ABI_PATH = path.resolve(REPO_ROOT, 'lunes-dex-main', 'src', 'abis', 'CopyVault.json')
const ASYMMETRIC_PAIR_ABI_PATH = path.resolve(REPO_ROOT, 'lunes-dex-main', 'src', 'abis', 'AsymmetricPair.json')

function getAnalyticsDb() {
  const db = prisma as any
  if (
    typeof db.socialAnalyticsCursor?.findUnique !== 'function' ||
    typeof db.socialIndexedEvent?.findFirst !== 'function'
  ) {
    return null
  }

  return db
}

function toSerializable(value: any): any {
  if (value == null) return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map((entry) => toSerializable(entry))
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toSerializable(entry)]),
    )
  }
  return String(value)
}

function collectPrimitiveValues(value: any, output: Array<string | number> = []): Array<string | number> {
  if (value == null) return output

  if (typeof value === 'string' || typeof value === 'number') {
    output.push(value)
    return output
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectPrimitiveValues(entry, output))
    return output
  }

  if (typeof value === 'object') {
    Object.values(value).forEach((entry) => collectPrimitiveValues(entry, output))
  }

  return output
}

function extractAddresses(payload: any, signer?: string | null) {
  const values = collectPrimitiveValues(payload)
  const addresses = values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => ACCOUNT_REGEX.test(value))

  if (signer && ACCOUNT_REGEX.test(signer)) {
    addresses.unshift(signer)
  }

  return Array.from(new Set(addresses))
}

function extractNumbers(payload: any) {
  return collectPrimitiveValues(payload)
    .map((value) => {
      if (typeof value === 'number') return value
      const normalized = value.replace(/,/g, '').trim()
      if (!normalized) return Number.NaN
      const parsed = Number(normalized)
      return Number.isFinite(parsed) ? parsed : Number.NaN
    })
    .filter((value) => Number.isFinite(value))
}

function extractPairSymbol(payload: any) {
  const values = collectPrimitiveValues(payload)
  const matched = values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.match(PAIR_REGEX)?.[0])
    .find(Boolean)

  return matched || null
}

function deriveKind(section: string, method: string): IndexedEventKind {
  const pallet = section.toLowerCase()
  const eventName = method.toLowerCase()
  const key = `${pallet}.${eventName}`

  if (key.includes('swap')) return 'SWAP'
  if (key.includes('liquidityadd') || key.includes('minted')) return 'LIQUIDITY_ADD'
  if (key.includes('liquidityremove') || key.includes('burned')) return 'LIQUIDITY_REMOVE'
  if (key.includes('tradeopen') || key.includes('positionopened')) return 'TRADE_OPEN'
  if (key.includes('tradeclose') || key.includes('positionclosed') || key.includes('settled')) return 'TRADE_CLOSE'
  if (eventName.includes('deposit')) return pallet === 'balances' ? 'UNKNOWN' : 'VAULT_DEPOSIT'
  if (eventName.includes('withdraw')) return pallet === 'balances' ? 'UNKNOWN' : 'VAULT_WITHDRAW'

  return 'UNKNOWN'
}

function shouldTrackEvent(section: string, method: string) {
  const pallet = section.toLowerCase()
  const eventName = method.toLowerCase()
  const kind = deriveKind(section, method)

  if (pallet === 'balances' && (eventName === 'deposit' || eventName === 'withdraw')) {
    return false
  }

  if (kind !== 'UNKNOWN') return true
  if (config.socialAnalytics.trackedPallets.includes(pallet)) return true
  if (config.socialAnalytics.trackedMethods.includes(eventName)) return true

  return false
}

function getBlockTimestamp(extrinsics: any[]) {
  const timestampExtrinsic = extrinsics.find((extrinsic) => {
    const method = (extrinsic as any).method
    return method?.section?.toString() === 'timestamp' && method?.method?.toString() === 'set'
  })

  const raw = timestampExtrinsic?.method?.args?.[0]
  const timestamp = Number(raw?.toString?.() ?? Date.now())

  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now()
}

async function readJsonFile(filePath: string) {
  const content = await fs.readFile(filePath, 'utf-8')
  return JSON.parse(content)
}

function normalizeTokenSymbol(key: string) {
  if (key.toLowerCase() === 'wnative') return 'WLUNES'
  return key.toUpperCase()
}

function getTokenAliases(key: string, symbol: string) {
  return Array.from(new Set([key.toLowerCase(), symbol.toLowerCase()]))
}

function derivePairSymbolFromDeploymentKey(
  key: string,
  tokens: Array<{ key: string; symbol: string; aliases: string[] }>,
) {
  if (!key.toLowerCase().startsWith('pair')) return null

  const suffix = key.slice(4).toLowerCase()

  for (const left of tokens) {
    for (const leftAlias of left.aliases) {
      if (!suffix.startsWith(leftAlias)) continue

      const remaining = suffix.slice(leftAlias.length)
      for (const right of tokens) {
        for (const rightAlias of right.aliases) {
          if (remaining === rightAlias) {
            return `${left.symbol}/${right.symbol}`
          }
        }
      }
    }
  }

  return null
}

class SocialIndexerService {
  private api: ApiPromise | null = null
  private initPromise: Promise<boolean> | null = null
  private knownContracts = new Map<string, KnownContractDecoder>()
  private tokenSymbolsByAddress = new Map<string, string>()

  isEnabled() {
    return config.socialAnalytics.enabled && Boolean(config.blockchain.wsUrl)
  }

  private async initialize() {
    try {
      const provider = new WsProvider(config.blockchain.wsUrl)
      this.api = await ApiPromise.create({ provider })
      await this.api.isReady
      await this.loadKnownContracts()
      log.info('[SocialIndexer] Connected to blockchain node')
      return true
    } catch (error) {
      log.error({ err: error }, '[SocialIndexer] Failed to initialize')
      return false
    }
  }

  async ensureReady() {
    if (!this.isEnabled()) {
      return false
    }

    if (this.api) {
      return true
    }

    if (!this.initPromise) {
      this.initPromise = this.initialize()
    }

    return this.initPromise
  }

  private async getOrCreateCursor() {
    const db = getAnalyticsDb()
    if (!db) return null

    const existing = await db.socialAnalyticsCursor.findUnique({
      where: { chain: config.socialAnalytics.chainName },
    })

    if (existing) return existing

    return db.socialAnalyticsCursor.create({
      data: {
        chain: config.socialAnalytics.chainName,
        status: this.isEnabled() ? 'IDLE' : 'DISABLED',
      },
    })
  }

  async getStatus() {
    const db = getAnalyticsDb()
    const cursor = db
      ? await db.socialAnalyticsCursor.findUnique({ where: { chain: config.socialAnalytics.chainName } })
      : null

    return {
      enabled: this.isEnabled(),
      chain: config.socialAnalytics.chainName,
      cursor,
      ready: Boolean(this.api),
    }
  }

  private async updateCursor(data: Record<string, unknown>) {
    const db = getAnalyticsDb()
    if (!db) return null

    const cursor = await this.getOrCreateCursor()
    if (!cursor) return null

    return db.socialAnalyticsCursor.update({
      where: { chain: config.socialAnalytics.chainName },
      data,
    })
  }

  private async loadKnownContracts() {
    if (!this.api) return

    try {
      const [deployedAddresses, routerAbi, pairAbi, wnativeAbi, copyVaultAbi] = await Promise.all([
        readJsonFile(DEPLOYED_ADDRESSES_PATH),
        readJsonFile(ROUTER_ABI_PATH),
        readJsonFile(PAIR_ABI_PATH),
        readJsonFile(WNATIVE_ABI_PATH),
        readJsonFile(COPY_VAULT_ABI_PATH).catch(() => null),
      ])

      const tokenEntries = Object.entries(deployedAddresses)
        .filter(([key, value]) => {
          if (typeof value !== 'string' || !ACCOUNT_REGEX.test(value)) return false
          if (key === 'router' || key === 'factory' || key === 'staking' || key === 'rewards') return false
          if (key === 'pairCodeHash' || key.toLowerCase().startsWith('pair')) return false
          return true
        })
        .map(([key, address]) => {
          const symbol = normalizeTokenSymbol(key)
          return {
            key,
            address: String(address),
            symbol,
            aliases: getTokenAliases(key, symbol),
          }
        })

      this.tokenSymbolsByAddress = new Map(
        tokenEntries.map((entry) => [entry.address, entry.symbol]),
      )

      this.knownContracts = new Map()

      if (typeof deployedAddresses.router === 'string' && ACCOUNT_REGEX.test(deployedAddresses.router)) {
        this.knownContracts.set(
          deployedAddresses.router,
          {
            kind: 'router',
            contract: new ContractPromise(this.api as any, routerAbi as any, deployedAddresses.router),
          },
        )
      }

      if (typeof deployedAddresses.wnative === 'string' && ACCOUNT_REGEX.test(deployedAddresses.wnative)) {
        this.knownContracts.set(
          deployedAddresses.wnative,
          {
            kind: 'wnative',
            contract: new ContractPromise(this.api as any, wnativeAbi as any, deployedAddresses.wnative),
          },
        )
      }

      for (const [key, value] of Object.entries(deployedAddresses)) {
        if (!key.toLowerCase().startsWith('pair') || typeof value !== 'string' || !ACCOUNT_REGEX.test(value)) {
          continue
        }

        this.knownContracts.set(
          value,
          {
            kind: 'pair',
            pairSymbol: derivePairSymbolFromDeploymentKey(key, tokenEntries),
            contract: new ContractPromise(this.api as any, pairAbi as any, value),
          },
        )
      }

      // Register copy vault contracts
      if (copyVaultAbi) {
        for (const [key, value] of Object.entries(deployedAddresses)) {
          if (!key.toLowerCase().startsWith('copyvault') || typeof value !== 'string' || !ACCOUNT_REGEX.test(value)) {
            continue
          }
          this.knownContracts.set(value, {
            kind: 'copy_vault',
            contract: new ContractPromise(this.api as any, copyVaultAbi as any, value),
          })
        }
      }
    } catch (error) {
      log.warn({ err: error }, '[SocialIndexer] Failed to load known contract decoders')
    }
  }

  private getTokenSymbol(address: string | null | undefined) {
    if (!address) return null
    return this.tokenSymbolsByAddress.get(address) ?? null
  }

  private getPairSymbolFromPath(pathValue: unknown) {
    if (!Array.isArray(pathValue) || pathValue.length < 2) return null

    const addresses = pathValue.map((entry) => String(entry))
    const first = this.getTokenSymbol(addresses[0])
    const last = this.getTokenSymbol(addresses[addresses.length - 1])

    if (!first || !last) return null
    return `${first}/${last}`
  }

  private buildDecodedPayload(decoded: any) {
    const eventArgs = Array.isArray(decoded?.args) ? decoded.args : []
    const metadataArgs = (Array.isArray(decoded?.event?.args) ? decoded.event.args : []) as any[]

    return metadataArgs.reduce((acc: Record<string, unknown>, metaArg: any, index: number) => {
      const label = String((metaArg as any)?.label ?? (metaArg as any)?.name ?? `arg${index}`)
      const value = eventArgs[index]
      acc[label] = toSerializable(
        value?.toJSON ? value.toJSON() : value?.toHuman ? value.toHuman() : value?.toString?.() ?? value,
      )
      return acc
    }, {})
  }

  private normalizeDecodedContractEvent(
    contractKind: KnownContractKind,
    method: string,
    payload: Record<string, unknown>,
    signer?: string | null,
    pairSymbol?: string | null,
  ): NormalizedIndexedEvent {
    if (contractKind === 'router' && method === 'LiquidityAdded') {
      return {
        pallet: 'contracts.router',
        method,
        kind: 'LIQUIDITY_ADD',
        accountAddress: signer || String(payload.to ?? ''),
        counterpartyAddress: String(payload.to ?? ''),
        pairSymbol: this.getPairSymbolFromPath([payload.token_a, payload.token_b]) || pairSymbol || null,
        amountIn: Number(payload.amount_a ?? 0),
        amountOut: Number(payload.amount_b ?? 0),
        price: null,
        realizedPnl: null,
        payload,
      }
    }

    if (contractKind === 'router' && method === 'LiquidityRemoved') {
      return {
        pallet: 'contracts.router',
        method,
        kind: 'LIQUIDITY_REMOVE',
        accountAddress: signer || String(payload.to ?? ''),
        counterpartyAddress: String(payload.to ?? ''),
        pairSymbol: this.getPairSymbolFromPath([payload.token_a, payload.token_b]) || pairSymbol || null,
        amountIn: Number(payload.amount_a ?? 0),
        amountOut: Number(payload.amount_b ?? 0),
        price: null,
        realizedPnl: null,
        payload,
      }
    }

    if (contractKind === 'router' && method === 'Swap') {
      return {
        pallet: 'contracts.router',
        method,
        kind: 'SWAP',
        accountAddress: String(payload.sender ?? signer ?? ''),
        counterpartyAddress: String(payload.to ?? ''),
        pairSymbol: this.getPairSymbolFromPath(payload.path) || pairSymbol || null,
        amountIn: Number(payload.amount_in ?? 0),
        amountOut: Number(payload.amount_out ?? 0),
        price: null,
        realizedPnl: null,
        payload,
      }
    }

    if (contractKind === 'pair' && method === 'Mint') {
      return {
        pallet: 'contracts.pair',
        method,
        kind: 'LIQUIDITY_ADD',
        accountAddress: String(payload.sender ?? signer ?? ''),
        counterpartyAddress: null,
        pairSymbol: pairSymbol || null,
        amountIn: Math.max(Number(payload.amount_0 ?? 0), Number(payload.amount_1 ?? 0)),
        amountOut: Math.min(Number(payload.amount_0 ?? 0), Number(payload.amount_1 ?? 0)),
        price: null,
        realizedPnl: null,
        payload,
      }
    }

    if (contractKind === 'pair' && method === 'Burn') {
      return {
        pallet: 'contracts.pair',
        method,
        kind: 'LIQUIDITY_REMOVE',
        accountAddress: String(payload.sender ?? signer ?? ''),
        counterpartyAddress: String(payload.to ?? ''),
        pairSymbol: pairSymbol || null,
        amountIn: Math.max(Number(payload.amount_0 ?? 0), Number(payload.amount_1 ?? 0)),
        amountOut: Math.min(Number(payload.amount_0 ?? 0), Number(payload.amount_1 ?? 0)),
        price: null,
        realizedPnl: null,
        payload,
      }
    }

    if (contractKind === 'pair' && method === 'Swap') {
      return {
        pallet: 'contracts.pair',
        method,
        kind: 'SWAP',
        accountAddress: String(payload.sender ?? signer ?? ''),
        counterpartyAddress: String(payload.to ?? ''),
        pairSymbol: pairSymbol || null,
        amountIn: Math.max(Number(payload.amount_0_in ?? 0), Number(payload.amount_1_in ?? 0)),
        amountOut: Math.max(Number(payload.amount_0_out ?? 0), Number(payload.amount_1_out ?? 0)),
        price: null,
        realizedPnl: null,
        payload,
      }
    }

    if (contractKind === 'wnative' && method === 'Deposit') {
      return {
        pallet: 'contracts.wnative',
        method,
        kind: 'VAULT_DEPOSIT',
        accountAddress: String(payload.dst ?? signer ?? ''),
        counterpartyAddress: null,
        pairSymbol: null,
        amountIn: Number(payload.wad ?? 0),
        amountOut: null,
        price: null,
        realizedPnl: null,
        payload,
      }
    }

    if (contractKind === 'wnative' && method === 'Withdrawal') {
      return {
        pallet: 'contracts.wnative',
        method,
        kind: 'VAULT_WITHDRAW',
        accountAddress: String(payload.src ?? signer ?? ''),
        counterpartyAddress: null,
        pairSymbol: null,
        amountIn: null,
        amountOut: Number(payload.wad ?? 0),
        price: null,
        realizedPnl: null,
        payload,
      }
    }

    // ─── Copy Vault Events ────────────────────────────────────
    if (contractKind === 'copy_vault' && method === 'Deposited') {
      return {
        pallet: 'contracts.copy_vault',
        method,
        kind: 'VAULT_DEPOSIT',
        accountAddress: String(payload.depositor ?? signer ?? ''),
        counterpartyAddress: null,
        pairSymbol: null,
        amountIn: Number(payload.amount ?? 0),
        amountOut: Number(payload.shares_minted ?? 0),
        price: Number(payload.share_price ?? 0),
        realizedPnl: null,
        payload,
      }
    }

    if (contractKind === 'copy_vault' && method === 'Withdrawn') {
      return {
        pallet: 'contracts.copy_vault',
        method,
        kind: 'VAULT_WITHDRAW',
        accountAddress: String(payload.depositor ?? signer ?? ''),
        counterpartyAddress: null,
        pairSymbol: null,
        amountIn: Number(payload.shares_burned ?? 0),
        amountOut: Number(payload.amount_received ?? 0),
        price: null,
        realizedPnl: Number(payload.performance_fee ?? 0) * -1,
        payload,
      }
    }

    if (contractKind === 'copy_vault' && method === 'TradeExecuted') {
      const pairBytes = payload.pair as unknown
      const pairStr = Array.isArray(pairBytes)
        ? String.fromCharCode(...(pairBytes as number[]))
        : String(pairBytes ?? '')

      return {
        pallet: 'contracts.copy_vault',
        method,
        kind: 'SWAP',
        accountAddress: String(payload.leader ?? signer ?? ''),
        counterpartyAddress: null,
        pairSymbol: pairStr.includes('/') ? pairStr : null,
        amountIn: Number(payload.amount ?? 0),
        amountOut: Number(payload.vault_equity_after ?? 0),
        price: null,
        realizedPnl: null,
        payload,
      }
    }

    if (contractKind === 'copy_vault' && method === 'CircuitBreakerTriggered') {
      return {
        pallet: 'contracts.copy_vault',
        method,
        kind: 'TRADE_CLOSE',
        accountAddress: String(payload.vault ?? signer ?? ''),
        counterpartyAddress: null,
        pairSymbol: null,
        amountIn: Number(payload.current_equity ?? 0),
        amountOut: Number(payload.high_water_mark ?? 0),
        price: null,
        realizedPnl: null,
        payload: { ...payload, drawdown_bps: Number(payload.drawdown_bps ?? 0) },
      }
    }

    return {
      pallet: `contracts.${contractKind}`,
      method,
      kind: deriveKind(contractKind, method),
      accountAddress: signer || null,
      counterpartyAddress: null,
      pairSymbol: pairSymbol || null,
      amountIn: null,
      amountOut: null,
      price: null,
      realizedPnl: null,
      payload,
    }
  }

  private tryDecodeContractEvent(contractAddress: string, eventData: unknown, signer?: string | null) {
    const decoder = this.knownContracts.get(contractAddress)
    if (!decoder) return null

    try {
      const decoded = (decoder.contract.abi as any).decodeEvent(eventData as any)
      const method = String(decoded?.event?.identifier ?? decoded?.event?.label ?? 'Unknown')
      const payload = this.buildDecodedPayload(decoded)
      return this.normalizeDecodedContractEvent(decoder.kind, method, payload, signer, decoder.pairSymbol)
    } catch (error) {
      log.warn({ err: error, contractAddress }, '[SocialIndexer] Failed to decode contract event')
      return null
    }
  }

  private normalizeEvent(section: string, method: string, payload: any, signer?: string | null): NormalizedIndexedEvent {
    const addresses = extractAddresses(payload, signer)
    const numbers = extractNumbers(payload)

    return {
      pallet: section,
      method,
      kind: deriveKind(section, method),
      accountAddress: signer || addresses[0] || null,
      counterpartyAddress: addresses.find((address) => address !== signer) || null,
      pairSymbol: extractPairSymbol(payload),
      amountIn: numbers[0] ?? null,
      amountOut: numbers[1] ?? null,
      price: numbers[2] ?? null,
      realizedPnl: numbers[3] ?? null,
      payload,
    }
  }

  private isPrunedBlockError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const normalized = message.toLowerCase()

    return normalized.includes('state already discarded') || normalized.includes('unknown block')
  }

  private getRecoveryStartBlock(latestBlock: number) {
    return Math.max(latestBlock - config.socialAnalytics.maxBlocksPerRun + 1, 1)
  }

  private async processRange(startBlock: number, endBlock: number) {
    let totalIndexedEvents = 0
    let lastProcessedHash: string | null = null

    for (let blockNumber = startBlock; blockNumber <= endBlock; blockNumber += 1) {
      const summary = await this.processBlock(blockNumber)
      totalIndexedEvents += summary.indexedEvents
      lastProcessedHash = summary.blockHash
      await this.updateCursor({
        lastProcessedBlock: blockNumber,
        lastProcessedHash: summary.blockHash,
        lastProcessedAt: new Date(),
      })
    }

    return {
      processedBlocks: endBlock - startBlock + 1,
      indexedEvents: totalIndexedEvents,
      lastProcessedBlock: endBlock,
      lastProcessedHash,
    }
  }

  private async processBlock(blockNumber: number) {
    if (!this.api) {
      throw new Error('Indexer API is not initialized')
    }

    const db = getAnalyticsDb()
    if (!db) {
      return { blockHash: null, indexedEvents: 0 }
    }

    const blockHash = (await this.api.rpc.chain.getBlockHash(blockNumber)).toString()
    const [signedBlock, eventRecords] = await Promise.all([
      this.api.rpc.chain.getBlock(blockHash),
      this.api.query.system.events.at(blockHash),
    ])

    const extrinsics = signedBlock.block.extrinsics
    const eventRecordList = Array.from(eventRecords as unknown as any[])
    const blockTimestamp = getBlockTimestamp(extrinsics)
    let indexedEvents = 0

    for (let eventIndex = 0; eventIndex < eventRecordList.length; eventIndex += 1) {
      const record = eventRecordList[eventIndex] as any
      const event = record.event
      const section = String(event.section)
      const method = String(event.method)
      const isContractEmitted = section === 'contracts' && method === 'ContractEmitted'

      if (!isContractEmitted && !shouldTrackEvent(section, method)) {
        continue
      }

      const phase = record.phase
      const extrinsicIndex = phase?.isApplyExtrinsic ? phase.asApplyExtrinsic.toNumber() : null
      const extrinsic = extrinsicIndex != null ? extrinsics[extrinsicIndex] : null
      const signer = extrinsic && (extrinsic as any).isSigned ? (extrinsic as any).signer.toString() : null
      const extrinsicHash = extrinsic ? extrinsic.hash.toHex() : null
      const eventData = Array.from((event.data as unknown as any[]) ?? [])

      let normalized: NormalizedIndexedEvent | null = null
      if (section === 'contracts' && method === 'ContractEmitted' && eventData.length >= 2) {
        normalized = this.tryDecodeContractEvent(String(eventData[0]), eventData[1], signer)
      }

      const payload = normalized?.payload ?? toSerializable(event.toHuman ? event.toHuman() : event.toJSON())

      if (!normalized) {
        if (!shouldTrackEvent(section, method)) {
          continue
        }

        normalized = this.normalizeEvent(section, method, payload, signer)
      }

      const existing = await db.socialIndexedEvent.findFirst({
        where: {
          chain: config.socialAnalytics.chainName,
          blockNumber,
          eventIndex,
        },
      })

      if (existing) {
        continue
      }

      await db.socialIndexedEvent.create({
        data: {
          chain: config.socialAnalytics.chainName,
          blockNumber,
          blockHash,
          eventIndex,
          extrinsicIndex,
          extrinsicHash,
          pallet: normalized.pallet,
          method: normalized.method,
          kind: normalized.kind,
          accountAddress: normalized.accountAddress,
          counterpartyAddress: normalized.counterpartyAddress,
          pairSymbol: normalized.pairSymbol,
          amountIn: normalized.amountIn,
          amountOut: normalized.amountOut,
          price: normalized.price,
          realizedPnl: normalized.realizedPnl,
          timestamp: new Date(blockTimestamp),
          payload,
        },
      })

      indexedEvents += 1
    }

    return { blockHash, indexedEvents }
  }

  // ── SubQuery primary source ────────────────────────────────────
  // When SUBQUERY_ENDPOINT is configured, pull events from SubQuery GraphQL
  // instead of polling the blockchain directly. Much faster and more reliable.
  private async syncFromSubquery(leaderAddresses: string[]): Promise<{
    indexedEvents: number
    latestBlock: number
  }> {
    const db = getAnalyticsDb()
    if (!db || leaderAddresses.length === 0) return { indexedEvents: 0, latestBlock: 0 }

    let totalIndexed = 0
    const latestBlock = await subqueryClient.getLatestIndexedBlock()

    for (const address of leaderAddresses) {
      const { swaps, vaultEvents, tradeEvents } = await subqueryClient.getAllEventsByAddress(address, 1000)

      // Map SubQuery SwapEvent → SocialIndexedEvent
      for (const swap of swaps) {
        const blockNumber = parseInt(swap.blockNumber, 10)
        const existing = await db.socialIndexedEvent.findFirst({
          where: {
            chain: config.socialAnalytics.chainName,
            blockNumber,
            accountAddress: swap.trader,
            kind: 'SWAP',
            extrinsicHash: swap.extrinsicHash ?? undefined,
          },
        })
        if (existing) continue

        await db.socialIndexedEvent.create({
          data: {
            chain: config.socialAnalytics.chainName,
            blockNumber,
            blockHash: null,
            eventIndex: 0,
            extrinsicIndex: null,
            extrinsicHash: swap.extrinsicHash ?? null,
            pallet: 'subquery.router',
            method: 'Swap',
            kind: 'SWAP',
            accountAddress: swap.trader,
            counterpartyAddress: null,
            pairSymbol: swap.pairSymbol ?? null,
            amountIn: parseFloat(swap.amountIn) / 1e12,
            amountOut: parseFloat(swap.amountOut) / 1e12,
            price: null,
            realizedPnl: null,
            timestamp: new Date(swap.timestamp),
            payload: { source: 'subquery', tokenIn: swap.tokenIn, tokenOut: swap.tokenOut },
          },
        })
        totalIndexed += 1
      }

      // Map SubQuery VaultEvent → SocialIndexedEvent
      for (const vault of vaultEvents) {
        const blockNumber = parseInt(vault.blockNumber, 10)
        const kindMap: Record<string, IndexedEventKind> = {
          DEPOSIT: 'VAULT_DEPOSIT',
          WITHDRAW: 'VAULT_WITHDRAW',
          TRADE_EXECUTED: 'SWAP',
          CIRCUIT_BREAKER: 'TRADE_CLOSE',
        }
        const kind: IndexedEventKind = kindMap[vault.kind] ?? 'UNKNOWN'

        const existing = await db.socialIndexedEvent.findFirst({
          where: {
            chain: config.socialAnalytics.chainName,
            blockNumber,
            accountAddress: vault.actor,
            kind,
            extrinsicHash: vault.extrinsicHash ?? undefined,
          },
        })
        if (existing) continue

        await db.socialIndexedEvent.create({
          data: {
            chain: config.socialAnalytics.chainName,
            blockNumber,
            blockHash: null,
            eventIndex: 0,
            extrinsicIndex: null,
            extrinsicHash: vault.extrinsicHash ?? null,
            pallet: 'subquery.copy_vault',
            method: vault.kind,
            kind,
            accountAddress: vault.leader ?? vault.actor,
            counterpartyAddress: vault.actor !== vault.leader ? vault.actor : null,
            pairSymbol: vault.pairSymbol ?? null,
            amountIn: vault.amountIn ? parseFloat(vault.amountIn) / 1e12 : null,
            amountOut: vault.amountOut ? parseFloat(vault.amountOut) / 1e12 : null,
            price: null,
            realizedPnl: null,
            timestamp: new Date(vault.timestamp),
            payload: { source: 'subquery', equityAfter: vault.equityAfter, drawdownBps: vault.drawdownBps },
          },
        })
        totalIndexed += 1
      }

      // Map SubQuery TradeEvent → SocialIndexedEvent
      for (const trade of tradeEvents) {
        const blockNumber = parseInt(trade.blockNumber, 10)
        const kind: IndexedEventKind = trade.kind === 'CLOSE' ? 'TRADE_CLOSE' : 'TRADE_OPEN'

        const existing = await db.socialIndexedEvent.findFirst({
          where: {
            chain: config.socialAnalytics.chainName,
            blockNumber,
            accountAddress: trade.trader,
            kind,
            extrinsicHash: trade.extrinsicHash ?? undefined,
          },
        })
        if (existing) continue

        await db.socialIndexedEvent.create({
          data: {
            chain: config.socialAnalytics.chainName,
            blockNumber,
            blockHash: null,
            eventIndex: 0,
            extrinsicIndex: null,
            extrinsicHash: trade.extrinsicHash ?? null,
            pallet: 'subquery.trade',
            method: trade.kind,
            kind,
            accountAddress: trade.trader,
            counterpartyAddress: null,
            pairSymbol: trade.pairSymbol ?? null,
            amountIn: trade.size ? parseFloat(trade.size) / 1e12 : null,
            amountOut: null,
            price: null,
            realizedPnl: trade.realizedPnl ? parseFloat(trade.realizedPnl) / 1e12 : null,
            timestamp: new Date(trade.timestamp),
            payload: { source: 'subquery', side: trade.side },
          },
        })
        totalIndexed += 1
      }
    }

    if (latestBlock > 0) {
      await this.updateCursor({
        status: 'IDLE',
        lastProcessedBlock: latestBlock,
        lastProcessedAt: new Date(),
        lastError: null,
      })
    }

    return { indexedEvents: totalIndexed, latestBlock }
  }

  async syncOnce() {
    if (!this.isEnabled()) {
      await this.updateCursor({ status: 'DISABLED' })
      return { enabled: false, processedBlocks: 0, indexedEvents: 0 }
    }

    const db = getAnalyticsDb()
    if (!db) {
      return { enabled: true, processedBlocks: 0, indexedEvents: 0, prismaReady: false }
    }

    // ── SubQuery primary path ──────────────────────────────────
    if (config.subquery.enabled && subqueryClient.isEnabled()) {
      try {
        await this.updateCursor({ status: 'RUNNING', lastError: null })

        const leaders = await (prisma as any).leader.findMany({ select: { address: true } }).catch(() => [])
        const addresses = (leaders as Array<{ address: string }>).map((l) => l.address)

        const result = await this.syncFromSubquery(addresses)
        log.info({ indexedEvents: result.indexedEvents, latestBlock: result.latestBlock }, '[SocialIndexer] SubQuery sync complete')

        return {
          enabled: true,
          source: 'subquery',
          processedBlocks: 0,
          indexedEvents: result.indexedEvents,
          latestBlock: result.latestBlock,
          prismaReady: true,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'SubQuery sync failed'
        log.warn({ message }, '[SocialIndexer] SubQuery sync failed, falling back to RPC')
        await this.updateCursor({ status: 'ERROR', lastError: `SubQuery: ${message}` })
        // Fall through to RPC polling below
      }
    }

    // ── RPC polling fallback ───────────────────────────────────
    const isReady = await this.ensureReady()
    if (!isReady || !this.api) {
      await this.updateCursor({ status: 'ERROR', lastError: 'Blockchain API unavailable' })
      return { enabled: true, source: 'rpc', processedBlocks: 0, indexedEvents: 0, prismaReady: true }
    }

    const latestHeader = await this.api.rpc.chain.getHeader()
    const latestBlock = latestHeader.number.toNumber()
    const cursor = await this.getOrCreateCursor()

    if (!cursor) {
      return { enabled: true, processedBlocks: 0, indexedEvents: 0, prismaReady: true }
    }

    const startBlock = cursor.lastProcessedBlock > 0
      ? cursor.lastProcessedBlock + 1
      : Math.max(
        config.socialAnalytics.startBlock,
        Math.max(latestBlock - config.socialAnalytics.backfillBlocks + 1, 1),
      )

    if (startBlock > latestBlock) {
      await this.updateCursor({ status: 'IDLE', lastProcessedAt: new Date(), lastError: null })
      return {
        enabled: true,
        processedBlocks: 0,
        indexedEvents: 0,
        latestBlock,
        lastProcessedBlock: cursor.lastProcessedBlock,
      }
    }

    const endBlock = Math.min(latestBlock, startBlock + config.socialAnalytics.maxBlocksPerRun - 1)

    await this.updateCursor({ status: 'RUNNING', lastError: null })

    try {
      const summary = await this.processRange(startBlock, endBlock)
      await this.updateCursor({ status: 'IDLE', lastError: null })

      return {
        enabled: true,
        processedBlocks: summary.processedBlocks,
        indexedEvents: summary.indexedEvents,
        latestBlock,
        lastProcessedBlock: summary.lastProcessedBlock,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown indexing error'

      if (this.isPrunedBlockError(error)) {
        const recoveryStartBlock = this.getRecoveryStartBlock(latestBlock)

        if (recoveryStartBlock > startBlock) {
          await this.updateCursor({
            status: 'RUNNING',
            lastProcessedBlock: recoveryStartBlock - 1,
            lastProcessedHash: null,
            lastProcessedAt: new Date(),
            lastError: `Historical backfill skipped. Node pruned older state. Resuming from block ${recoveryStartBlock}. Original error: ${message}`,
          })

          try {
            const recoveryEndBlock = Math.min(latestBlock, recoveryStartBlock + config.socialAnalytics.maxBlocksPerRun - 1)
            const recoveredSummary = await this.processRange(recoveryStartBlock, recoveryEndBlock)
            await this.updateCursor({ status: 'IDLE', lastError: null })

            return {
              enabled: true,
              processedBlocks: recoveredSummary.processedBlocks,
              indexedEvents: recoveredSummary.indexedEvents,
              latestBlock,
              lastProcessedBlock: recoveredSummary.lastProcessedBlock,
              recovered: true,
            }
          } catch (recoveryError) {
            const recoveryMessage = recoveryError instanceof Error ? recoveryError.message : 'Unknown indexing error'
            await this.updateCursor({ status: 'ERROR', lastError: recoveryMessage })
            throw recoveryError
          }
        }
      }

      await this.updateCursor({ status: 'ERROR', lastError: message })
      throw error
    }
  }
}

export const socialIndexerService = new SocialIndexerService()
