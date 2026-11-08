import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const reportError = vi.fn()
vi.mock('../services/telemetry', () => ({ reportError: (...a: unknown[]) => reportError(...a) }))

import ErrorBoundary from './ErrorBoundary'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const Boom: React.FC = () => {
  throw new Error('render exploded')
}

it('reports caught render errors to telemetry (source=boundary) and shows the fallback', () => {
  act(() =>
    root.render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )
  )
  expect(container.textContent).toContain('Something went wrong')
  expect(reportError).toHaveBeenCalledTimes(1)
  const [err, source] = reportError.mock.calls[0]
  expect(source).toBe('boundary')
  expect((err as Error).message).toBe('render exploded')
  expect((err as Error).stack).toContain('component stack')
})
