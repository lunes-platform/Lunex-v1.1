import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWebMCP } from './useWebMCP'

// FE-02: no third-party script may be injected at runtime (the old code
// loaded unpkg `@latest` without SRI). Only a native window.WebMCP is used.

const Probe: React.FC = () => {
  useWebMCP()
  return null
}

let container: HTMLDivElement
let root: Root

const mount = async () => {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <Probe />
      </MemoryRouter>
    )
  })
}

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete (window as { WebMCP?: unknown }).WebMCP
})

describe('useWebMCP (FE-02)', () => {
  it('never injects a remote <script>', async () => {
    const before = document.querySelectorAll('script').length
    await mount()
    expect(document.querySelectorAll('script').length).toBe(before)
    expect(document.querySelector('script[src*="unpkg.com"]')).toBeNull()
  })

  it('registers tools when the browser provides WebMCP natively', async () => {
    const registerTool = vi.fn()
    ;(window as { WebMCP?: unknown }).WebMCP = vi.fn(function WebMCP() {
      return {
        registerTool,
        registerPrompt: vi.fn(),
        registerResource: vi.fn()
      }
    })
    await mount()
    expect(window.WebMCP).toHaveBeenCalled()
    expect(registerTool).toHaveBeenCalled()
  })
})
