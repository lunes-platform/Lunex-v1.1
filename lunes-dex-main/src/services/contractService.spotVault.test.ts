// P0-5: the spot settlement vault is funded by the USER's own wallet
// (deposit_native payable / exact PSP22 approve + deposit_psp22) and drained
// by withdraw_*. Every call is dry-run first, never broadcast when the dry-run
// reverts, and resolves ONLY on finality.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SpotSettlementABI from '../abis/SpotSettlement.json'

const { VAULT } = vi.hoisted(() => ({
  VAULT: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y'
}))
const TOKEN = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'
const USER = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'

const mocks = vi.hoisted(() => ({
  setSigningChainGenesis: vi.fn(),
  create: vi.fn()
}))

vi.mock('../wallet/activeWallet', () => ({
  getSignerFor: vi.fn(() => ({ signPayload: vi.fn() }))
}))
vi.mock('../config/contracts', async importOriginal => {
  const orig = await importOriginal<typeof import('../config/contracts')>()
  return {
    ...orig,
    CONTRACTS: { ...orig.CONTRACTS, SPOT_SETTLEMENT: VAULT }
  }
})
vi.mock('../utils/signing', async importOriginal => ({
  ...(await importOriginal<typeof import('../utils/signing')>()),
  setSigningChainGenesis: mocks.setSigningChainGenesis
}))
vi.mock('@polkadot/api', () => ({
  ApiPromise: { create: mocks.create },
  WsProvider: class {}
}))
vi.mock('@polkadot/api-contract', () => ({ ContractPromise: class {} }))

import { contractService } from './contractService'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const service = contractService as any
type TxCallback = (result: unknown) => void

const inBlock = {
  status: { isInBlock: true, isFinalized: false },
  txHash: { toHex: () => '0xtx' }
}
const finalized = {
  status: {
    isInBlock: false,
    isFinalized: true,
    asFinalized: { toHex: () => '0xblock' }
  },
  txHash: { toHex: () => '0xtx' }
}

function install(opts: { dryOutput?: unknown; statuses?: unknown[] } = {}) {
  const signAndSend = vi.fn(
    (_a: string, _o: unknown, cb: TxCallback): Promise<() => void> => {
      ;(opts.statuses ?? [inBlock, finalized]).forEach(s => cb(s))
      return Promise.resolve(() => undefined)
    }
  )
  const dry = () =>
    vi.fn().mockResolvedValue({
      result: { isOk: true, isErr: false },
      gasRequired: { refTime: 1 },
      output: { toJSON: () => opts.dryOutput ?? { ok: { ok: null } } }
    })
  const methods = [
    'depositNative',
    'depositPsp22',
    'withdrawNative',
    'withdrawPsp22',
    'approve'
  ]
  const query = Object.fromEntries(methods.map(m => [m, dry()]))
  const tx = Object.fromEntries(methods.map(m => [m, vi.fn(() => ({ signAndSend }))]))
  const ctor = vi.fn((_api: unknown, _abi: unknown, _addr: string) => ({
    query,
    tx
  }))
  service.api = { registry: { createType: vi.fn(() => ({})) } }
  service.isConnected = true
  service.ContractPromiseCtor = ctor
  return { ctor, query, tx, signAndSend }
}

afterEach(() => {
  service.api = null
  service.isConnected = false
  vi.clearAllMocks()
})

describe('spot vault deposits', () => {
  it('deposits native LUNES as the payable value of deposit_native on the vault', async () => {
    const c = install()
    await expect(
      contractService.spotVaultDepositNative(USER, '150000000')
    ).resolves.toEqual({ txHash: '0xtx', blockHash: '0xblock' })
    expect(c.ctor.mock.calls[0][2]).toBe(VAULT)
    expect(c.query.depositNative).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ value: '150000000' })
    )
    expect(c.tx.depositNative).toHaveBeenCalledWith(
      expect.objectContaining({ value: '150000000' })
    )
  })

  it('deposits a PSP22 with (token, amount) and no value', async () => {
    const c = install()
    await contractService.spotVaultDepositPsp22(USER, TOKEN, '42000000')
    const [opts, token, amount] = c.tx.depositPsp22.mock.calls[0] as unknown[]
    expect(token).toBe(TOKEN)
    expect(amount).toBe('42000000')
    expect(opts).not.toHaveProperty('value')
  })

  it('approves the vault for EXACTLY the deposit amount on the token contract', async () => {
    const c = install()
    await contractService.spotVaultApprove(USER, TOKEN, '42000000')
    expect(c.ctor.mock.calls[0][2]).toBe(TOKEN)
    const [, spender, amount] = c.tx.approve.mock.calls[0] as unknown[]
    expect(spender).toBe(VAULT)
    expect(amount).toBe('42000000')
  })
})

describe('spot vault withdrawals', () => {
  it('withdraws native and PSP22 with the amount argument', async () => {
    const c = install()
    await contractService.spotVaultWithdrawNative(USER, '7')
    expect((c.tx.withdrawNative.mock.calls[0] as unknown[])[1]).toBe('7')
    await contractService.spotVaultWithdrawPsp22(USER, TOKEN, '8')
    const call = c.tx.withdrawPsp22.mock.calls[0] as unknown[]
    expect(call.slice(1)).toEqual([TOKEN, '8'])
  })
})

describe('spot vault safety', () => {
  it('never broadcasts when the dry-run returns a SpotError', async () => {
    const c = install({ dryOutput: { ok: { err: 'WithdrawExceedsBalance' } } })
    await expect(
      contractService.spotVaultWithdrawNative(USER, '7')
    ).rejects.toThrow(/available vault balance/i)
    expect(c.signAndSend).not.toHaveBeenCalled()
  })

  it('does not resolve at isInBlock — only at isFinalized', async () => {
    install({ statuses: [inBlock] })
    let settled = false
    void contractService
      .spotVaultDepositNative(USER, '150000000')
      .then(() => (settled = true))
    await new Promise(r => setTimeout(r, 20))
    expect(settled).toBe(false)
  })

  it('rejects on a dispatch error (reverted extrinsic)', async () => {
    install({
      statuses: [
        {
          dispatchError: { isModule: false, toString: () => 'BadOrigin' },
          status: { isInBlock: true, isFinalized: false }
        }
      ]
    })
    await expect(
      contractService.spotVaultDepositNative(USER, '150000000')
    ).rejects.toThrow('BadOrigin')
  })

  it('only calls messages that exist in the bundled SpotSettlement ABI', () => {
    const labels = new Set(
      SpotSettlementABI.spec.messages.map((m: { label: string }) => m.label)
    )
    for (const m of [
      'deposit_native',
      'deposit_psp22',
      'withdraw_native',
      'withdraw_psp22'
    ]) {
      expect(labels.has(m)).toBe(true)
    }
    const native = SpotSettlementABI.spec.messages.find(
      (m: { label: string }) => m.label === 'deposit_native'
    ) as { payable: boolean }
    expect(native.payable).toBe(true)
  })
})

describe('signing chain genesis', () => {
  beforeEach(() => {
    service.api = null
    service.isConnected = false
  })

  it('binds signed messages to the connected chain genesis after connect()', async () => {
    mocks.create.mockResolvedValue({
      isReady: Promise.resolve(),
      genesisHash: { toHex: () => '0xGENESIS' }
    })
    await expect(contractService.connect('testnet')).resolves.toBe(true)
    expect(mocks.setSigningChainGenesis).toHaveBeenCalledWith('0xGENESIS')
  })

  it('does not set a genesis when the connection fails', async () => {
    mocks.create.mockRejectedValue(new Error('ws down'))
    await expect(contractService.connect('testnet')).resolves.toBe(false)
    expect(mocks.setSigningChainGenesis).not.toHaveBeenCalled()
  })
})
