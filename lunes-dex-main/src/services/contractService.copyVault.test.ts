// BE-02: CopyVault deposit/withdraw are signed by the FOLLOWER's wallet on the
// vault contract, broadcast only after a clean dry-run, and resolve only once
// the block is finalized (txHash + finalized blockHash are the API proof).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { contractService } from './contractService'

vi.mock('../wallet/activeWallet', () => ({
  getSignerFor: vi.fn(() => ({ signPayload: vi.fn() }))
}))

const follower = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
const vault = '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y'
const account = { address: follower, meta: { source: 'polkadot-js' } } as any
const service = contractService as any

type TxCallback = (result: any) => void

function installVaultContract(opts: {
  dryOutput?: unknown
  requestOutput?: unknown
  statuses: any[]
}) {
  const signAndSend = vi.fn(
    (_addr: string, _opts: unknown, cb: TxCallback): Promise<() => void> => {
      opts.statuses.forEach(s => cb(s))
      return Promise.resolve(() => undefined)
    }
  )
  const txDeposit = vi.fn(() => ({ signAndSend }))
  const txWithdraw = vi.fn(() => ({ signAndSend }))
  const txRequestWithdrawal = vi.fn(() => ({ signAndSend }))
  const query = {
    deposit: vi.fn().mockResolvedValue({
      result: { isOk: true, isErr: false },
      gasRequired: { refTime: 1 },
      output: { toJSON: () => opts.dryOutput ?? { ok: { ok: '1' } } }
    }),
    withdraw: vi.fn().mockResolvedValue({
      result: { isOk: true, isErr: false },
      gasRequired: { refTime: 1 },
      output: { toJSON: () => opts.dryOutput ?? { ok: { ok: '1' } } }
    }),
    requestWithdrawal: vi.fn().mockResolvedValue({
      result: { isOk: true, isErr: false },
      gasRequired: { refTime: 1 },
      output: { toJSON: () => opts.dryOutput ?? { ok: { ok: 86_401_000 } } }
    }),
    getWithdrawalRequest: vi.fn().mockResolvedValue({
      result: { isOk: true, isErr: false },
      output: {
        toJSON: () =>
          opts.requestOutput ?? {
            ok: {
              shares: '0x0000000000000000000000012a05f200',
              requestedAt: 1000
            }
          }
      }
    })
  }
  const ctor = vi.fn(() => ({
    query,
    tx: {
      deposit: txDeposit,
      withdraw: txWithdraw,
      requestWithdrawal: txRequestWithdrawal
    }
  }))
  service.api = { registry: { createType: vi.fn(() => ({})) } }
  service.ContractPromiseCtor = ctor
  return {
    ctor,
    query,
    txDeposit,
    txWithdraw,
    txRequestWithdrawal,
    signAndSend
  }
}

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

afterEach(() => {
  service.api = null
  service.ContractPromiseCtor = null
})

describe('contractService.depositToCopyVault', () => {
  it('signs with the follower and resolves {txHash, blockHash} only on finality', async () => {
    const { ctor, query, txDeposit, signAndSend } = installVaultContract({
      statuses: [inBlock, finalized]
    })

    const proof = await contractService.depositToCopyVault(
      vault,
      '1500000000',
      account
    )

    expect(proof).toEqual({ txHash: '0xtx', blockHash: '0xblock' })
    expect((ctor.mock.calls[0] as unknown[])[2]).toBe(vault)
    expect(query.deposit).toHaveBeenCalledWith(
      follower,
      expect.objectContaining({ value: '1500000000' })
    )
    expect(txDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ value: '1500000000' })
    )
    // Signed by the follower address with the wallet signer (never a relayer).
    expect(signAndSend.mock.calls[0][0]).toBe(follower)
    expect(signAndSend.mock.calls[0][1]).toHaveProperty('signer')
  })

  it('does not resolve on inBlock alone', async () => {
    installVaultContract({ statuses: [inBlock] })
    const settled = vi.fn()
    contractService
      .depositToCopyVault(vault, '1500000000', account)
      .then(settled, settled)
    await new Promise(r => setTimeout(r, 20))
    expect(settled).not.toHaveBeenCalled()
  })

  it('never broadcasts when the dry-run returns a contract error', async () => {
    const { txDeposit } = installVaultContract({
      dryOutput: { ok: { err: 'BelowMinimumDeposit' } },
      statuses: [finalized]
    })

    await expect(
      contractService.depositToCopyVault(vault, '1', account)
    ).rejects.toThrow('BelowMinimumDeposit')
    expect(txDeposit).not.toHaveBeenCalled()
  })

  it('rejects on a dispatch error', async () => {
    installVaultContract({
      statuses: [
        {
          dispatchError: { isModule: false, toString: () => 'BadOrigin' },
          status: {},
          txHash: { toHex: () => '0xtx' }
        }
      ]
    })

    await expect(
      contractService.depositToCopyVault(vault, '1500000000', account)
    ).rejects.toThrow('BadOrigin')
  })
})

describe('contractService.withdrawFromCopyVault', () => {
  it('burns shares signed by the follower and resolves on finality', async () => {
    const { query, txWithdraw, signAndSend } = installVaultContract({
      statuses: [finalized]
    })

    const proof = await contractService.withdrawFromCopyVault(
      vault,
      '500000000',
      account
    )

    expect(proof).toEqual({ txHash: '0xtx', blockHash: '0xblock' })
    expect(query.withdraw).toHaveBeenCalledWith(
      follower,
      expect.anything(),
      '500000000'
    )
    expect(txWithdraw).toHaveBeenCalledWith(expect.anything(), '500000000')
    expect(signAndSend.mock.calls[0][0]).toBe(follower)
  })

  it('surfaces CooldownActive from the dry-run without broadcasting', async () => {
    const { txWithdraw } = installVaultContract({
      dryOutput: { ok: { err: 'CooldownActive' } },
      statuses: [finalized]
    })

    await expect(
      contractService.withdrawFromCopyVault(vault, '500000000', account)
    ).rejects.toThrow('CooldownActive')
    expect(txWithdraw).not.toHaveBeenCalled()
  })
})

describe('contractService large-withdrawal cooldown', () => {
  it('requests the cooldown with a follower-signed tx resolved on finality', async () => {
    const { txRequestWithdrawal, signAndSend } = installVaultContract({
      statuses: [inBlock, finalized]
    })

    const proof = await contractService.requestCopyVaultWithdrawal(
      vault,
      '500000000',
      account
    )

    expect(proof).toEqual({ txHash: '0xtx', blockHash: '0xblock' })
    expect(txRequestWithdrawal).toHaveBeenCalledWith(
      expect.anything(),
      '500000000'
    )
    expect(signAndSend.mock.calls[0][0]).toBe(follower)
  })

  it('reads the pending request (u128 shares) and its unlock time', async () => {
    const { query } = installVaultContract({ statuses: [] })

    const pending = await contractService.getCopyVaultWithdrawalRequest(
      vault,
      follower
    )

    expect(query.getWithdrawalRequest).toHaveBeenCalledWith(
      follower,
      expect.anything(),
      follower
    )
    expect(pending).toEqual({
      shares: '5000000000',
      unlockAt: 1000 + 24 * 60 * 60 * 1000
    })
  })

  it('returns null when there is no pending request', async () => {
    installVaultContract({ statuses: [], requestOutput: { ok: null } })
    await expect(
      contractService.getCopyVaultWithdrawalRequest(vault, follower)
    ).resolves.toBeNull()
  })
})
