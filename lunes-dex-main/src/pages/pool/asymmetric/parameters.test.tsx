import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CurveSide } from '../../../components/asymmetric/CurveChart'

const mocks = vi.hoisted(() => {
  // Pair tokens are read from env when the page module loads.
  process.env.REACT_APP_TOKEN_WLUNES = 'wlunes-address'
  process.env.REACT_APP_TOKEN_LUSDT = 'lusdt-address'
  return {
    sign: vi.fn(),
    createDeployment: vi.fn(),
    calls: [] as string[],
    runs: [] as any[],
    preview: { buy: {} as CurveSide, sell: {} as CurveSide }
  }
})
vi.mock('../../../context/SDKContext', () => ({
  useSDK: () => ({
    isConnected: true,
    walletAddress: 'bob',
    signMessage: mocks.sign
  })
}))
// Fake tx runner at the TxProvider boundary: runs every step in order.
vi.mock('../../../context/TxContext', () => ({
  useTx: () => ({
    run: async (cfg: any) => {
      mocks.runs.push(cfg)
      for (const step of cfg.steps) await step.run?.({ advance: () => {} })
      cfg.onSuccess?.()
    }
  })
}))
vi.mock('../../../hooks/useAsymmetricDeploy', () => ({
  useAsymmetricDeploy: () => ({ createDeployment: mocks.createDeployment })
}))
vi.mock('../../../hooks/usePools', () => ({
  usePools: () => ({ prices: {} })
}))
vi.mock('../../../hooks/useReadSession', () => ({
  useReadSession: () => ({ hasSession: true })
}))
vi.mock('../../../components/session/ReadSessionPrompt', () => ({
  ReadSessionPrompt: () => null
}))
vi.mock('../../../components/asymmetric/AgentDelegationPanel', () => ({
  DEFAULT_GUARDRAILS: { gammaMin: 1, gammaMax: 3 },
  DelegationCard: () => null,
  ApiKeyDialog: () => null,
  enforceDelegation: vi.fn(),
  useAiAgents: () => []
}))
// Capture what the live preview chart is asked to draw.
vi.mock('../../../components/asymmetric/CurveChart', async importOriginal => ({
  ...(await importOriginal<
    typeof import('../../../components/asymmetric/CurveChart')
  >()),
  default: (props: typeof mocks.preview) => {
    mocks.preview = { buy: props.buy, sell: props.sell }
    return null
  }
}))
vi.mock('../../../sdk/AsymmetricClient', () => ({
  AsymmetricClient: class {
    async listStrategies() {
      return []
    }
  }
}))
import AsymmetricPool from './index'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement
beforeEach(async () => {
  mocks.calls = []
  mocks.runs = []
  mocks.sign.mockResolvedValue('0xsignature')
  mocks.createDeployment.mockImplementation(() => ({
    instantiate: async () => {
      mocks.calls.push('instantiate')
      return '0xinstantiate'
    },
    seed: async () => {
      mocks.calls.push('seed')
      return '0xseed'
    },
    register: async () => {
      mocks.calls.push('register')
      return { strategyId: 's1', contractAddress: 'pair', txHash: '0xreg' }
    },
    result: () => ({ strategyId: 's1' })
  }))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      <MemoryRouter>
        <AsymmetricPool />
      </MemoryRouter>
    )
  )
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})
async function click(name: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    item => item.textContent === name || item.textContent?.startsWith(name)
  )
  expect(button, name).toBeTruthy()
  await act(async () => button!.click())
}
function summary(label: string) {
  const row = Array.from(container.querySelectorAll('span')).find(
    s => s.textContent === label
  )?.parentElement
  expect(row, label).toBeTruthy()
  return row!.lastElementChild!.textContent
}

it('applies the full selected template to both preview curves', async () => {
  await click('Stablecoin Range')
  for (const side of [mocks.preview.buy, mocks.preview.sell]) {
    expect(side).toEqual({ k: 2000, x0: 20000, g: 5 })
  }
  expect(summary('Fee target')).toBe('0.10%')

  await click('Deploy asymmetric strategy')
  expect(mocks.createDeployment).toHaveBeenCalledWith(
    expect.objectContaining({
      buyGamma: 5,
      sellGamma: 5,
      buyMaxCapacity: '20000',
      sellMaxCapacity: '20000',
      buyFeeBps: 10,
      sellFeeBps: 10,
      profitTargetBps: 100
    })
  )
})

it('deploys the same buy and sell liquidity shown in the preview', async () => {
  // default preset (Buy the Dip): buy k 1000, sell k 200
  expect(mocks.preview.buy.k).toBe(1000)
  expect(mocks.preview.sell.k).toBe(200)
  await click('Deploy asymmetric strategy')
  expect(mocks.calls).toEqual(['instantiate', 'seed', 'register'])
  expect(mocks.createDeployment).toHaveBeenCalledWith(
    expect.objectContaining({
      initialBuyK: String(mocks.preview.buy.k),
      initialSellK: String(mocks.preview.sell.k)
    })
  )
})
