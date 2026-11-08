import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// The redesign removed `components/bases/input` (wrapper + native input).
// Its replacements are the design-kit primitives: `Input` (a plain styled
// input) and the `Field` container + `BareInput` composition used by the new
// forms. The guarantee is unchanged: identifiers, accessible name and change
// handlers land on the native <input> only — never on the wrapper — so ids
// stay unique and screen readers / tests address the real control.
import { BareInput, Field, Input } from '../../ui/kit'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('design-kit inputs', () => {
  it('Input assigns identifiers and change handlers only to the native input', () => {
    const onChange = vi.fn()
    act(() =>
      root.render(<Input id="amount" aria-label="Amount" onChange={onChange} />)
    )
    expect(container.querySelectorAll('#amount')).toHaveLength(1)
    expect(container.querySelector('[aria-label="Amount"]')?.tagName).toBe(
      'INPUT'
    )
    type(container.querySelector('input')!, '12')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('Field + BareInput keep identifiers and change handlers on the native input, not the wrapper', () => {
    const onChange = vi.fn()
    act(() =>
      root.render(
        <Field>
          <BareInput id="amount" aria-label="Amount" onChange={onChange} />
        </Field>
      )
    )
    expect(container.querySelectorAll('#amount')).toHaveLength(1)
    expect(container.querySelectorAll('[aria-label="Amount"]')).toHaveLength(1)
    expect(container.querySelector('#amount')?.tagName).toBe('INPUT')
    expect(container.querySelector('[data-field]')?.id).toBe('')
    type(container.querySelector('input')!, '12')
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
