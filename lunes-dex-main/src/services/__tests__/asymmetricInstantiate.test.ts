// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
const NEW_CONTRACT = '5FhMi6TN1XZyM8kEsz31Lv1Za8e1i5JmYVwWQcYLDQLefP6J'

let statusCallback: ((r: any) => void) | null = null

vi.mock('@polkadot/api-contract', () => ({
  ContractPromise: vi.fn(),
  CodePromise: class {
    tx = {
      new: () => ({
        signAndSend: (_addr: string, _opts: unknown, cb: (r: any) => void) => {
          statusCallback = cb
          return Promise.resolve(() => undefined)
        }
      })
    }
  }
}))
vi.mock('../../wallet/activeWallet', () => ({ getSignerFor: () => ({}) }))

import { asymmetricContractService } from '../asymmetricContractService'

const instantiatedEvents = [
  {
    event: {
      section: 'contracts',
      method: 'Instantiated',
      data: [{ toString: () => ALICE }, { toString: () => NEW_CONTRACT }]
    }
  }
]

describe('asymmetricContractService.instantiate', () => {
  it('resolves the new address only once the block is finalized', async () => {
    asymmetricContractService.setApi({
      registry: { createType: () => ({}) }
    } as any)
    const p = asymmetricContractService.instantiate(
      { source: { wasm: '0x00' } },
      'base',
      'quote',
      1,
      '1',
      30,
      1,
      '1',
      30,
      { address: ALICE, meta: {} } as any
    )
    let settled = false
    p.then(() => (settled = true))
    await Promise.resolve()

    // In-block only: a reorg could still drop the instantiation, and the
    // caller funds this address right after — must not resolve yet.
    statusCallback!({
      status: { isInBlock: true, isFinalized: false },
      events: instantiatedEvents
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(settled).toBe(false)

    statusCallback!({
      status: { isInBlock: false, isFinalized: true },
      events: instantiatedEvents
    })
    await expect(p).resolves.toBe(NEW_CONTRACT)
  })
})
