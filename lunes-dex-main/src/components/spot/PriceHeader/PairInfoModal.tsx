import React, { useEffect, useState } from 'react'
import { useSpot } from 'context/SpotContext'
import { spotApi } from 'services/spotService'
import { Dialog } from 'components/ui/Dialog'
import { C, SkeletonLine, short } from 'components/ui/kit'
import { T, fmtPx, fq, splitPair } from '../terminal'
import { Dot, RowKV, Rows, Tile, Tiles } from './parts'

type MarketInfo = {
  pair?: {
    baseName: string
    quoteName: string
    baseToken: string
    quoteToken: string
    pairAddress: string | null
    makerFeeBps: number
    takerFeeBps: number
    listingDate: string
  }
  onChain?: {
    swapCount: number | string
    lastSwapAt: string | null
  } | null
}

const PairInfoModal: React.FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose
}) => {
  const { selectedPair, ticker, isConnected } = useSpot()
  const [info, setInfo] = useState<MarketInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [base] = splitPair(selectedPair)

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    spotApi
      .getMarketInfo(selectedPair)
      .then((d: MarketInfo) => alive && setInfo(d))
      .catch(() => alive && setInfo(null))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [open, selectedPair])

  const price = ticker?.lastPrice ?? 0
  const chg = ticker?.change24h ?? 0
  const pair = info?.pair

  const stats: Array<[string, string, string?]> = [
    ['Price', fmtPx(price)],
    [
      '24h change',
      price > 0 ? `${chg > 0 ? '+' : ''}${chg.toFixed(2)}%` : '—',
      price > 0 ? (chg >= 0 ? T.up : T.down) : undefined
    ],
    ['Trades 24h', ticker ? ticker.tradeCount.toLocaleString('en-US') : '—'],
    ['24h high', fmtPx(ticker?.high24h)],
    ['24h low', fmtPx(ticker?.low24h)],
    ['24h volume', ticker?.volume24h ? `${fq(ticker.volume24h)} ${base}` : '—']
  ]

  const rows: Array<[string, React.ReactNode, boolean?]> = pair
    ? [
        ['Base token', pair.baseName],
        ['Quote token', pair.quoteName],
        ['Base address', short(pair.baseToken), true],
        ['Quote address', short(pair.quoteToken), true],
        ...(pair.pairAddress
          ? [
              ['Pair contract', short(pair.pairAddress), true] as [
                string,
                string,
                boolean
              ]
            ]
          : []),
        ['Maker fee', `${(pair.makerFeeBps / 100).toFixed(2)}%`],
        ['Taker fee', `${(pair.takerFeeBps / 100).toFixed(2)}%`],
        [
          'Listed',
          new Date(pair.listingDate).toLocaleDateString('en-US', {
            month: 'short',
            year: 'numeric'
          })
        ]
      ]
    : []

  if (info?.onChain) {
    rows.push(
      [
        'On-chain swaps',
        Number(info.onChain.swapCount).toLocaleString('en-US')
      ],
      [
        'Last swap',
        info.onChain.lastSwapAt
          ? new Date(info.onChain.lastSwapAt).toLocaleString('en-US')
          : '—'
      ]
    )
  }
  rows.push(
    [
      'SubQuery indexer',
      <Dot key="sq" $on={!!info?.onChain}>
        {info?.onChain ? 'Live' : 'Offline'}
      </Dot>
    ],
    [
      'API status',
      <Dot key="api" $on={isConnected}>
        {isConnected ? 'Connected' : 'Offline'}
      </Dot>
    ]
  )

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${selectedPair} info`}
      width={460}
      padding={22}
    >
      <Tiles>
        {stats.map(([l, v, color]) => (
          <Tile key={l}>
            <div>{l}</div>
            <div style={{ color: color ?? C.text }}>{v}</div>
          </Tile>
        ))}
      </Tiles>
      <Rows>
        {loading && !pair
          ? [0, 1, 2, 3].map(i => (
              <RowKV key={i}>
                <SkeletonLine $w="40%" $h={12} />
                <SkeletonLine $w="30%" $h={12} />
              </RowKV>
            ))
          : rows.map(([l, v, mono]) => (
              <RowKV key={l} $mono={mono}>
                <span>{l}</span>
                <span>{v}</span>
              </RowKV>
            ))}
      </Rows>
    </Dialog>
  )
}

export default PairInfoModal
