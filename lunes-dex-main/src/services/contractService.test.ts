import { afterEach, expect, it, vi } from 'vitest'
import { contractService } from './contractService'

vi.mock('@polkadot/extension-dapp', () => ({
  web3FromAddress: vi.fn().mockResolvedValue({ signer: {} })
}))
// Signing goes through the active wallet adapter (extension or WalletConnect).
vi.mock('../wallet/activeWallet', () => ({
  getSignerFor: vi.fn(() => ({}))
}))

const alice = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
const bob = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'
const service = contractService as any
afterEach(() => {
  service.api = null
  service.factoryContract = null
  service.routerContract = null
  service.contracts = null
})

it('does not broadcast native liquidity when the dry-run returns a nested contract error', async () => {
  service.api = { registry: { createType: vi.fn() } }
  service.contracts = { router: alice }
  vi.spyOn(contractService, 'getAllowance').mockResolvedValue('999999999999')
  const broadcast = vi.fn()
  service.routerContract = {
    query: {
      addLiquidityNative: vi.fn().mockResolvedValue({
        result: { isOk: true, isErr: false },
        gasRequired: {},
        output: {
          toJSON: () => ({ ok: { err: { insufficientBAmount: null } } })
        }
      })
    },
    tx: { addLiquidityNative: broadcast }
  }
  await expect(
    contractService.addLiquidityNative(
      bob,
      '10',
      '20',
      '9',
      '19',
      bob,
      9999999999,
      { address: bob, meta: { source: 'polkadot-js' } }
    )
  ).rejects.toThrow('insufficientBAmount')
  expect(broadcast).not.toHaveBeenCalled()
})

it.each([
  [{ ok: null }, null],
  [{ ok: { ok: null } }, null],
  [{ err: 'NotFound' }, null],
  [{ ok: '0x' + '00'.repeat(32) }, null],
  [{ ok: bob }, bob],
  [{ ok: { ok: bob } }, bob]
])('decodes the factory pair result %j', async (json, expected) => {
  service.api = { registry: { createType: vi.fn() } }
  service.factoryContract = {
    query: {
      getPair: vi.fn().mockResolvedValue({
        result: { isOk: true },
        output: { toJSON: () => json }
      })
    }
  }
  expect(await contractService.getPair(alice, bob)).toBe(expected)
})
