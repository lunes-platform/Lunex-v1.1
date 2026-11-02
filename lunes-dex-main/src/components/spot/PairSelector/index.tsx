import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import { ChevronDown, Search } from 'lucide-react'
import { useSpot } from 'context/SpotContext'
import { spotApi, SpotTicker } from 'services/spotService'
import { C, EASE_OUT, grotesk, tabular } from 'components/ui/kit'
import { riseIn } from '../../../styles/motion'
import { useFavorites } from '../../../hooks/useFavorites'
import { T, fmtPx, fq, splitPair, tokenIcon } from '../terminal'

// Lunes ecosystem bases — used by the LUNES filter
const LUNES_BASES = ['LUNES', 'WLUNES', 'LBTC', 'LETH', 'GMC', 'LUP']

type Filter = 'fav' | 'all' | 'LUNES' | 'LUSDT'
const FILTERS: Array<[Filter, string]> = [
  ['fav', '★'],
  ['all', 'All'],
  ['LUNES', 'LUNES'],
  ['LUSDT', 'LUSDT']
]

const Wrap = styled.div`
  position: relative;
  flex-shrink: 0;
`

const Trigger = styled.button<{ $open: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  height: 42px;
  padding: 0 12px 0 8px;
  border-radius: 12px;
  border: 1px solid ${p => (p.$open ? C.primary : C.borderStrong)};
  background: ${C.surface};
  color: ${C.text};
  transition: border-color 150ms ease;
  &:hover {
    border-color: ${C.primary};
  }
  > b {
    ${grotesk};
    font-size: 17px;
    font-weight: 600;
    white-space: nowrap;
  }
  > svg {
    color: ${C.muted};
    transition: transform 200ms ${EASE_OUT};
    transform: rotate(${p => (p.$open ? 180 : 0)}deg);
  }
`

export const PairIcons = styled.div<{ $s?: number }>`
  display: flex;
  flex-shrink: 0;
  img {
    width: ${p => p.$s ?? 26}px;
    height: ${p => p.$s ?? 26}px;
    border-radius: 50%;
  }
  img + img {
    margin-left: -8px;
    border: 2px solid ${C.surface};
  }
`

const Pop = styled.div`
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  width: 380px;
  max-width: calc(100vw - 32px);
  background: ${C.surface};
  border: 1px solid ${C.borderStrong};
  border-radius: 16px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 50;
  animation: ${riseIn} 200ms ${EASE_OUT};
`

const SearchBox = styled.div.attrs({ 'data-field': '' })`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid ${C.primary};
  background: ${C.bg};
  color: ${C.muted};
  input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: ${C.text};
    font-size: 14px;
  }
`

const Filters = styled.div`
  display: flex;
  gap: 4px;
`

const FilterBtn = styled.button<{ $on: boolean }>`
  height: 30px;
  padding: 0 12px;
  border: none;
  border-radius: 8px;
  background: ${p => (p.$on ? T.line : 'transparent')};
  color: ${p => (p.$on ? C.text : C.muted)};
  font-size: 12px;
  font-weight: 600;
  &:hover {
    color: ${C.text};
  }
`

const GRID = '24px 1fr auto 64px'

const Head = styled.div`
  display: grid;
  grid-template-columns: ${GRID};
  gap: 8px;
  padding: 0 6px;
  font-size: 11px;
  color: ${C.muted};
  span:nth-child(n + 3) {
    text-align: right;
  }
`

const List = styled.div`
  display: flex;
  flex-direction: column;
  max-height: 320px;
  overflow-y: auto;
`

const Item = styled.div<{ $on: boolean }>`
  display: grid;
  grid-template-columns: ${GRID};
  gap: 8px;
  align-items: center;
  padding: 8px 6px;
  border-radius: 10px;
  cursor: pointer;
  background: ${p => (p.$on ? 'rgba(108,56,255,0.12)' : 'transparent')};
  transition: background-color 150ms ease;
  &:hover {
    background: ${T.line};
  }
`

const Star = styled.button<{ $on: boolean }>`
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: ${p => (p.$on ? C.warning : C.borderStrong)};
  font-size: 15px;
  padding: 0;
  transition: color 150ms ease;
  &:hover {
    color: ${C.warning};
  }
`

const Sym = styled.span`
  ${grotesk};
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  min-width: 0;
  img {
    width: 20px;
    height: 20px;
    border-radius: 50%;
  }
`

const PriceCol = styled.span`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  ${tabular};
  b {
    font-size: 13px;
    font-weight: 500;
  }
  small {
    font-size: 11px;
    color: ${C.muted};
  }
`

const Chg = styled.span<{ $up: boolean }>`
  ${tabular};
  text-align: right;
  font-size: 13px;
  font-weight: 600;
  color: ${p => (p.$up ? T.up : T.down)};
`

const None = styled.div`
  padding: 20px;
  text-align: center;
  font-size: 13px;
  color: ${C.muted};
`

const PairSelector: React.FC = () => {
  const { selectedPair, setSelectedPair, pairs, ticker, walletAddress } =
    useSpot()
  const { isFavorite, toggleFavorite } = useFavorites(walletAddress)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [tickers, setTickers] = useState<Record<string, SpotTicker>>({})
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Load a ticker for every listed pair when the list opens (real data).
  useEffect(() => {
    if (!open || pairs.length === 0) return
    let alive = true
    Promise.all(
      pairs.map(p =>
        spotApi
          .getTicker(p.symbol)
          .then(t => [p.symbol, t] as const)
          .catch(() => null)
      )
    ).then(res => {
      if (!alive) return
      const next: Record<string, SpotTicker> = {}
      res.forEach(r => {
        if (r) next[r[0]] = r[1]
      })
      setTickers(next)
    })
    return () => {
      alive = false
    }
  }, [open, pairs])

  // Outside click + Esc close
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node))
        setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    searchRef.current?.focus()
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const rows = useMemo(() => {
    const q = search.trim().toUpperCase()
    return pairs
      .map(p => {
        const live =
          ticker?.symbol === p.symbol ? ticker : tickers[p.symbol] || null
        const [base, quote] = splitPair(p.symbol)
        return {
          symbol: p.symbol,
          base,
          quote,
          price: live?.lastPrice ?? 0,
          chg: live?.change24h ?? 0,
          vol: live?.volume24h ?? 0
        }
      })
      .filter(r => {
        if (filter === 'fav' && !isFavorite(r.symbol)) return false
        if (
          filter === 'LUNES' &&
          !(LUNES_BASES.includes(r.base) || r.quote === 'LUNES')
        )
          return false
        if (filter === 'LUSDT' && r.quote !== 'LUSDT') return false
        return !q || r.symbol.includes(q)
      })
  }, [pairs, ticker, tickers, filter, isFavorite, search])

  const pick = useCallback(
    (symbol: string) => {
      setSelectedPair(symbol)
      setOpen(false)
      setSearch('')
    },
    [setSelectedPair]
  )

  const [base, quote] = splitPair(selectedPair)

  return (
    <Wrap ref={wrapRef}>
      <Trigger
        ref={triggerRef}
        $open={open}
        onClick={() => {
          setOpen(o => !o)
          setSearch('')
        }}
        aria-label="Select market"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <PairIcons>
          <img src={tokenIcon(base)} alt="" />
          <img src={tokenIcon(quote)} alt="" />
        </PairIcons>
        <b>{selectedPair}</b>
        <ChevronDown size={14} strokeWidth={2} />
      </Trigger>

      {open && (
        <Pop>
          <SearchBox>
            <Search size={15} strokeWidth={2} />
            <input
              ref={searchRef}
              data-bare=""
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search markets"
              aria-label="Search markets"
            />
          </SearchBox>
          <Filters>
            {FILTERS.map(([k, l]) => (
              <FilterBtn
                key={k}
                $on={filter === k}
                onClick={() => setFilter(k)}
                aria-pressed={filter === k}
                aria-label={k === 'fav' ? 'Favourites' : undefined}
              >
                {l}
              </FilterBtn>
            ))}
          </Filters>
          <Head>
            <span />
            <span>Market</span>
            <span>Price / Vol</span>
            <span>24h</span>
          </Head>
          <List role="listbox" aria-label="Markets">
            {rows.map(r => (
              <Item
                key={r.symbol}
                role="option"
                aria-selected={r.symbol === selectedPair}
                tabIndex={0}
                $on={r.symbol === selectedPair}
                onClick={() => pick(r.symbol)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    pick(r.symbol)
                  }
                }}
              >
                <Star
                  $on={isFavorite(r.symbol)}
                  aria-label={
                    isFavorite(r.symbol)
                      ? 'Remove from favourites'
                      : 'Add to favourites'
                  }
                  onClick={e => {
                    e.stopPropagation()
                    toggleFavorite(r.symbol)
                  }}
                >
                  ★
                </Star>
                <Sym>
                  <img src={tokenIcon(r.base)} alt="" />
                  {r.symbol}
                </Sym>
                <PriceCol>
                  <b>{fmtPx(r.price)}</b>
                  <small>Vol {r.vol > 0 ? fq(r.vol) : '—'}</small>
                </PriceCol>
                <Chg $up={r.chg >= 0}>
                  {r.price > 0
                    ? `${r.chg > 0 ? '+' : ''}${r.chg.toFixed(2)}%`
                    : '—'}
                </Chg>
              </Item>
            ))}
            {rows.length === 0 && (
              <None>
                {pairs.length === 0
                  ? 'Markets unavailable — spot-api offline'
                  : 'No markets found'}
              </None>
            )}
          </List>
        </Pop>
      )}
    </Wrap>
  )
}

export default PairSelector
