import { beforeEach, expect, it, vi } from 'vitest'

const getTicker = vi.fn()
vi.mock('../../services/spotService', () => ({ spotApi: { getTicker: (s: string) => getTicker(s) } }))

import { fetchLunesUsd } from './useLunesPrice'

beforeEach(() => getTicker.mockReset())

it('uses the last LUNES/LUSDT trade', async () => {
  getTicker.mockResolvedValue({ lastPrice: 0.021, tradeCount: 4 })
  expect(await fetchLunesUsd()).toBe(0.021)
  expect(getTicker).toHaveBeenCalledWith('LUNES/LUSDT')
})

it('falls back to WLUNES/LUSDT, and returns null when there is no market', async () => {
  getTicker.mockImplementation(async (s: string) =>
    s === 'WLUNES/LUSDT' ? { lastPrice: 0.03, tradeCount: 1 } : Promise.reject(new Error('404'))
  )
  expect(await fetchLunesUsd()).toBe(0.03)
  getTicker.mockResolvedValue({ lastPrice: 0, tradeCount: 0 })
  expect(await fetchLunesUsd()).toBeNull()
})
