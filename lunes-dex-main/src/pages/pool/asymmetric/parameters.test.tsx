import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { ThemeProvider } from 'styled-components'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import theme from '../../../theme'
import AsymmetricPool from './index'

const mocks = vi.hoisted(() => ({
  deploy: vi.fn(),
  sign: vi.fn(),
  preview: { buyParams: {} as any, sellParams: {} as any }
}))
vi.mock('../../../context/SDKContext', () => ({
  useSDK: () => ({
    isConnected: true,
    walletAddress: 'bob',
    signMessage: mocks.sign
  })
}))
vi.mock('../../../hooks/useAsymmetricDeploy', () => ({
  useAsymmetricDeploy: () => ({
    state: { step: 'idle' },
    deploy: mocks.deploy,
    reset: () => {}
  })
}))
vi.mock('../../../components/layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))
vi.mock('../../../components/tradeSubNav', () => ({ default: () => null }))
vi.mock('../../../components/asymmetric/AgentDelegationPanel', () => ({
  default: () => null
}))
vi.mock('../../../components/asymmetric/CurveChart', () => ({
  default: (props: typeof mocks.preview) => {
    mocks.preview = props
    return null
  },
  simulateLiquidity: () => 0
}))
vi.mock('../../../sdk/AsymmetricClient', () => ({
  AsymmetricClient: class {
    async listStrategies() {
      return []
    }
  }
}))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement
beforeEach(async () => {
  mocks.sign.mockResolvedValue('0xsignature')
  mocks.deploy.mockResolvedValue(undefined)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      <ThemeProvider theme={theme}>
        <AsymmetricPool />
      </ThemeProvider>
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

it('applies the full selected template to both preview curves', async () => {
  await click('Stablecoin Range')
  for (const side of [mocks.preview.buyParams, mocks.preview.sellParams]) {
    expect(side).toMatchObject({
      k: 5000,
      x0: 2000,
      gamma: 5,
      feeT: 0.001,
      L: 0
    })
  }
})

it('deploys the same buy and sell liquidity shown in the preview', async () => {
  await click('Builder Pro')
  expect(mocks.preview.buyParams.k).toBe(1000)
  expect(mocks.preview.sellParams.k).toBe(500)
  await click('Deploy Asymmetric Strategy')
  await click('Confirm & Deploy')
  expect(mocks.deploy).toHaveBeenCalledWith(
    expect.objectContaining({ initialBuyK: '1000', initialSellK: '500' })
  )
})
