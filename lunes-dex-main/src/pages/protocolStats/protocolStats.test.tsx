import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { expect, it } from 'vitest'
import ProtocolStats from './index'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

it('shows the current Pair fee split and uses it in the revenue simulation', () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  try {
    act(() => root.render(<ProtocolStats />))
    const text = container.textContent ?? ''
    expect(text).toContain('0.3% (60%)')
    expect(text.match(/0\.1% \(20%\)/g)).toHaveLength(2)
    expect(text).toContain('Trading Rewards')
    expect(text).toContain('AMM swap fee (0.1%')
    expect(text).not.toContain('requires on-chain contract update')
  } finally {
    act(() => root.unmount())
    container.remove()
  }
})
