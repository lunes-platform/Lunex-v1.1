import { describe, it, expect } from 'vitest'
import { buildDetailRows } from './details'

const base = {
  impact: 0,
  minReceived: 5,
  slippage: 0.5,
  fee: 0.025,
  fromSym: 'LUNES',
  toSym: 'WLUNES',
  route: ['LUNES', 'WLUNES']
}
const labels = (rows: { label: string }[]) => rows.map(r => r.label)

describe('buildDetailRows', () => {
  it('shows the swap fee and slippage for a router swap', () => {
    expect(labels(buildDetailRows(base))).toEqual(
      expect.arrayContaining(['Fee (0.5%)', 'Slippage tolerance'])
    )
  })

  it('omits fee and slippage for a 1:1 wrap/unwrap (no router, no fee)', () => {
    const rows = labels(buildDetailRows({ ...base, wrap: true }))
    expect(rows).not.toContain('Fee (0.5%)')
    expect(rows).not.toContain('Slippage tolerance')
    expect(rows).toContain('Minimum received')
  })
})
