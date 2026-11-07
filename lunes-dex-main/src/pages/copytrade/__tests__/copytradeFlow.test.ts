// BE-01/BE-02: the follower's wallet signs the on-chain CopyVault tx FIRST
// (finalized), then signs the API receipt that binds txHash/blockHash; the API
// only journals that proof. No vault contract → nothing is sent.
import { describe, expect, it, vi } from 'vitest'
import { buildCopyDepositSteps, buildCopyWithdrawSteps } from '../copytradeFlow'
import { buildWalletActionMessage } from '../../../services/socialService'

const follower = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
const vault = '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y'
const proof = { txHash: '0xtx', blockHash: '0xblock' }

async function runAll(steps: { run?: (ctx: any) => unknown }[]) {
  const results: unknown[] = []
  for (const step of steps) {
    if (step.run) results.push(await step.run({ advance: () => undefined }))
  }
  return results
}

function deps() {
  const calls: string[] = []
  return {
    calls,
    chain: {
      deposit: vi.fn(async (...args: unknown[]) => {
        calls.push('chain.deposit')
        void args
        return proof
      }),
      withdraw: vi.fn(async (...args: unknown[]) => {
        calls.push('chain.withdraw')
        void args
        return proof
      }),
      requestWithdrawal: vi.fn(async (...args: unknown[]) => {
        calls.push('chain.requestWithdrawal')
        void args
        return proof
      }),
      getWithdrawalRequest: vi.fn(
        async (): Promise<{ shares: string; unlockAt: number } | null> => null
      )
    },
    signMessage: vi.fn(async (msg: string) => {
      calls.push('sign')
      return `sig:${msg.length}`
    }),
    api: {
      depositToVault: vi.fn(async () => {
        calls.push('api.deposit')
        return { txHash: '0xtx' } as any
      }),
      withdrawFromVault: vi.fn(async () => {
        calls.push('api.withdraw')
        return { txHash: '0xtx' } as any
      })
    }
  }
}

describe('buildCopyDepositSteps', () => {
  it('deposits on-chain (plancks) before signing and posting the proof', async () => {
    const d = deps()
    const steps = buildCopyDepositSteps(
      {
        leaderId: 'leader-1',
        follower,
        vaultAddress: vault,
        token: 'LUNES',
        amount: '15',
        stopLossPct: 20
      },
      d
    )

    const results = await runAll(steps)

    expect(d.calls).toEqual(['chain.deposit', 'sign', 'api.deposit'])
    expect(d.chain.deposit).toHaveBeenCalledWith(vault, '1500000000', follower)
    const body = (d.api.depositToVault.mock.calls[0] as unknown[])[1] as any
    expect(body).toMatchObject({
      followerAddress: follower,
      token: 'LUNES',
      amount: '15',
      stopLossPct: 20,
      txHash: '0xtx',
      blockHash: '0xblock'
    })
    // The signed message is exactly what the backend rebuilds (incl. proof).
    const signed = d.signMessage.mock.calls[0][0]
    expect(signed).toBe(
      buildWalletActionMessage({
        action: 'copytrade.deposit',
        address: follower,
        nonce: body.nonce,
        timestamp: body.timestamp,
        fields: {
          leaderId: 'leader-1',
          token: 'LUNES',
          amount: '15',
          txHash: '0xtx',
          blockHash: '0xblock',
          stopLossPct: 20
        }
      })
    )
    expect(results[results.length - 1]).toBe('0xtx')
  })

  it('refuses to start when the vault has no on-chain contract', async () => {
    const d = deps()
    const steps = buildCopyDepositSteps(
      {
        leaderId: 'leader-1',
        follower,
        vaultAddress: null,
        token: 'LUNES',
        amount: '15'
      },
      d
    )

    await expect(runAll(steps)).rejects.toThrow(/not live on-chain/i)
    expect(d.chain.deposit).not.toHaveBeenCalled()
    expect(d.api.depositToVault).not.toHaveBeenCalled()
  })
})

describe('buildCopyWithdrawSteps', () => {
  it('withdraws on-chain (shares in plancks) before signing and posting the proof', async () => {
    const d = deps()
    const steps = buildCopyWithdrawSteps(
      {
        leaderId: 'leader-1',
        follower,
        vaultAddress: vault,
        shares: '5'
      },
      d
    )

    await runAll(steps)

    expect(d.calls).toEqual(['chain.withdraw', 'sign', 'api.withdraw'])
    expect(d.chain.withdraw).toHaveBeenCalledWith(vault, '500000000', follower)
    const body = (d.api.withdrawFromVault.mock.calls[0] as unknown[])[1]
    expect(body).toMatchObject({
      followerAddress: follower,
      shares: '5',
      txHash: '0xtx',
      blockHash: '0xblock'
    })
  })

  it('refuses to withdraw from a vault without contract', async () => {
    const d = deps()
    const steps = buildCopyWithdrawSteps(
      { leaderId: 'leader-1', follower, vaultAddress: undefined, shares: '5' },
      d
    )

    await expect(runAll(steps)).rejects.toThrow(/not live on-chain/i)
    expect(d.chain.withdraw).not.toHaveBeenCalled()
  })
})

describe('large withdrawals (> 10% of the vault, 24h cooldown)', () => {
  const cooldown = new Error(
    'CopyVault.withdraw would revert on-chain: CooldownActive'
  )

  it('starts the on-chain cooldown when no request is pending, then stops', async () => {
    const d = deps()
    d.chain.withdraw.mockRejectedValueOnce(cooldown)
    d.chain.getWithdrawalRequest
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ shares: '500000000', unlockAt: 86_401_000 })
    const steps = buildCopyWithdrawSteps(
      { leaderId: 'leader-1', follower, vaultAddress: vault, shares: '5' },
      d
    )

    await expect(runAll(steps)).rejects.toThrow(/requested on-chain/i)
    expect(d.chain.requestWithdrawal).toHaveBeenCalledWith(
      vault,
      '500000000',
      follower
    )
    expect(d.api.withdrawFromVault).not.toHaveBeenCalled()
  })

  it('does not restart a pending cooldown that already covers the shares', async () => {
    const d = deps()
    d.chain.withdraw.mockRejectedValueOnce(cooldown)
    d.chain.getWithdrawalRequest.mockResolvedValueOnce({
      shares: '900000000',
      unlockAt: Date.now() + 60_000
    })
    const steps = buildCopyWithdrawSteps(
      { leaderId: 'leader-1', follower, vaultAddress: vault, shares: '5' },
      d
    )

    await expect(runAll(steps)).rejects.toThrow(/unlocks at/i)
    expect(d.chain.requestWithdrawal).not.toHaveBeenCalled()
  })

  it('rethrows any other on-chain error untouched', async () => {
    const d = deps()
    d.chain.withdraw.mockRejectedValueOnce(new Error('InsufficientShares'))
    const steps = buildCopyWithdrawSteps(
      { leaderId: 'leader-1', follower, vaultAddress: vault, shares: '5' },
      d
    )

    await expect(runAll(steps)).rejects.toThrow('InsufficientShares')
    expect(d.chain.requestWithdrawal).not.toHaveBeenCalled()
  })
})
