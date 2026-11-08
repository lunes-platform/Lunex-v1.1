import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FeedbackModal } from './FeedbackModal'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const WALLET = '5HYVGHPrMmG6TKeczuTjhaGcRTkW8sMhWfppaFrTCAvKFfBb'
const TX = '0x' + 'cd'.repeat(32)

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
  document.body.innerHTML = ''
})

const q = <T extends Element>(sel: string) => document.body.querySelector(sel) as T | null

const typeInto = (el: HTMLTextAreaElement | HTMLSelectElement, value: string) =>
  act(() => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })

const sendButton = () =>
  [...document.body.querySelectorAll('button')].find(b => /Send report|Sending/.test(b.textContent || '')) as HTMLButtonElement

it('is anonymous by default: wallet/tx are not sent unless ticked', async () => {
  const submit = vi.fn(async () => ({ ok: true as const, id: 'abcdef123456' }))
  act(() => root.render(<FeedbackModal open onClose={() => undefined} walletAddress={WALLET} lastTxHash={TX} submit={submit} />))
  expect(sendButton().disabled).toBe(true)
  typeInto(q<HTMLSelectElement>('#fb-category')!, 'UX')
  typeInto(q<HTMLTextAreaElement>('#fb-message')!, 'The pool list flickers on refresh')
  expect(sendButton().disabled).toBe(false)
  await act(async () => sendButton().click())
  expect(submit).toHaveBeenCalledWith({
    category: 'UX',
    message: 'The pool list flickers on refresh',
    walletAddress: undefined,
    txHash: undefined
  })
  expect(document.body.textContent).toContain('ref abcdef12')
})

it('attaches wallet and last tx hash only when the tester opts in', async () => {
  const submit = vi.fn(async (_input: unknown) => ({ ok: true as const, id: 'x' }))
  act(() => root.render(<FeedbackModal open onClose={() => undefined} walletAddress={WALLET} lastTxHash={TX} submit={submit} />))
  typeInto(q<HTMLTextAreaElement>('#fb-message')!, 'Swap reverted with no message')
  const boxes = document.body.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
  expect(boxes).toHaveLength(2)
  act(() => boxes.forEach(b => b.click()))
  await act(async () => sendButton().click())
  expect(submit.mock.calls[0][0]).toMatchObject({ walletAddress: WALLET, txHash: TX })
})

it('shows the server error and keeps the message', async () => {
  const submit = vi.fn(async () => ({ ok: false as const, error: 'Too many reports' }))
  act(() => root.render(<FeedbackModal open onClose={() => undefined} submit={submit} />))
  typeInto(q<HTMLTextAreaElement>('#fb-message')!, 'Something broke here')
  await act(async () => sendButton().click())
  expect(q('[role="alert"]')?.textContent).toContain('Too many reports')
  expect(q<HTMLTextAreaElement>('#fb-message')!.value).toBe('Something broke here')
  // no wallet connected => no wallet checkbox offered
  expect(document.body.querySelectorAll('input[type=checkbox]')).toHaveLength(0)
})
