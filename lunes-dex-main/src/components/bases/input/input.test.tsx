import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { ThemeProvider } from 'styled-components'
import { expect, it, vi } from 'vitest'
import theme from '../../../theme'
import Input from './index'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

it('assigns identifiers and change handlers only to the native input', () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const onChange = vi.fn()
  try {
    act(() =>
      root.render(
        <ThemeProvider theme={theme}>
          <Input id="amount" aria-label="Amount" onChange={onChange} />
        </ThemeProvider>
      )
    )
    expect(container.querySelectorAll('#amount')).toHaveLength(1)
    expect(container.querySelector('[aria-label="Amount"]')?.tagName).toBe(
      'INPUT'
    )
    const input = container.querySelector('input')!
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!.call(input, '12')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledTimes(1)
  } finally {
    act(() => root.unmount())
    container.remove()
  }
})
