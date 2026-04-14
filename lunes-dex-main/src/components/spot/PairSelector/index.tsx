import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import styled, { keyframes } from 'styled-components'
import { useSpot } from 'context/SpotContext'
import { useFavorites } from '../../../hooks/useFavorites'

// ──────────── Animations ────────────

const slideDown = keyframes`
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
`

// ──────────── Styled Components ────────────

const Wrapper = styled.div`
  position: relative;
  flex-shrink: 0;
`

const Button = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 8px 14px;
  cursor: pointer;
  color: #ffffff;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.5px;
  transition: background 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
  }
`

const Arrow = styled.span<{ open: boolean }>`
  font-size: 10px;
  opacity: 0.6;
  transition: transform 0.2s;
  transform: ${({ open }) => (open ? 'rotate(180deg)' : 'rotate(0deg)')};
`

const Dropdown = styled.div`
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  background: #1a1a1a;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 8px;
  min-width: 320px;
  z-index: 100;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  animation: ${slideDown} 0.2s ease;
`

const SearchInput = styled.input`
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  color: #ffffff;
  outline: none;
  box-sizing: border-box;
  margin-bottom: 8px;
  transition: border-color 0.15s;

  &:focus {
    border-color: #00c076;
  }

  &::placeholder {
    color: rgba(255, 255, 255, 0.25);
  }
`

const FilterTabs = styled.div`
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
`

const FilterTab = styled.button<{ active?: boolean }>`
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
  background: ${({ active }) =>
    active ? 'rgba(108, 56, 255, 0.15)' : 'rgba(255,255,255,0.04)'};
  color: ${({ active }) => (active ? '#6C38FF' : 'rgba(255,255,255,0.5)')};

  &:hover {
    background: ${({ active }) =>
      active ? 'rgba(108, 56, 255, 0.2)' : 'rgba(255,255,255,0.08)'};
  }
`

const PairList = styled.div`
  max-height: 280px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.1) transparent;

  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
  }
`

const PairRow = styled.div<{ active?: boolean }>`
  display: grid;
  grid-template-columns: 24px 1fr auto auto;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
  background: ${({ active }) =>
    active ? 'rgba(108, 56, 255, 0.08)' : 'transparent'};

  &:hover {
    background: rgba(255, 255, 255, 0.06);
  }
`

const StarBtn = styled.button<{ isFav?: boolean }>`
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 14px;
  padding: 0;
  color: ${({ isFav }) => (isFav ? '#FFB800' : 'rgba(255,255,255,0.15)')};
  transition: color 0.15s;

  &:hover {
    color: #ffb800;
  }
`

const PairName = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: #ffffff;
`

const PairPrice = styled.span`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  text-align: right;
`

const PairChange = styled.span<{ positive: boolean }>`
  font-size: 11px;
  font-weight: 600;
  text-align: right;
  color: ${({ positive }) => (positive ? '#00C076' : '#FF4B55')};
  min-width: 60px;
`

const PairVolume = styled.span`
  font-size: 10px;
  color: rgba(255, 255, 255, 0.3);
  display: block;
`

const PriceCol = styled.div`
  text-align: right;
`

// ──────────── Data ────────────

interface PairData {
  symbol: string
  price: number
  change24h: number
  volume24h: number
  quote: string
}

// Lunes ecosystem base tokens — used to match LUNES tab filter
const LUNES_ECOSYSTEM_BASES = ['LUNES', 'WLUNES', 'LBTC', 'LETH', 'GMC', 'LUP']

type FilterType = 'all' | 'favorites' | 'LUNES' | 'LUSDT'

function formatVolume(vol: number): string {
  if (vol >= 1000000) return `${(vol / 1000000).toFixed(1)}M`
  if (vol >= 1000) return `${(vol / 1000).toFixed(0)}K`
  return vol.toString()
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toFixed(2)
  if (price >= 1) return price.toFixed(4)
  if (price >= 0.001) return price.toFixed(5)
  return price.toFixed(8)
}

// ──────────── Component ────────────

interface PairSelectorProps {
  value?: string
  onChange?: (pair: string) => void
}

const PairSelector: React.FC<PairSelectorProps> = ({ value, onChange }) => {
  const {
    selectedPair,
    setSelectedPair,
    pairs: apiPairs,
    ticker,
    walletAddress
  } = useSpot()
  const { isFavorite, toggleFavorite } = useFavorites(walletAddress)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(value || selectedPair)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')

  // Build PairData[] from API pairs (with ticker for live price).
  // Returns empty array if API is unavailable — never shows fake pairs.
  const allPairs: PairData[] = useMemo(() => {
    if (apiPairs.length > 0) {
      return apiPairs.map(p => {
        const quote = p.symbol.split('/')[1] || 'LUSDT'
        const livePrice = ticker?.symbol === p.symbol ? ticker.lastPrice : 0
        const liveChange = ticker?.symbol === p.symbol ? ticker.change24h : 0
        const liveVol = ticker?.symbol === p.symbol ? ticker.volume24h : 0
        return {
          symbol: p.symbol,
          price: livePrice,
          change24h: liveChange,
          volume24h: liveVol,
          quote
        }
      })
    }
    // API unavailable — return empty, do NOT show fake pairs
    return []
  }, [apiPairs, ticker])
  const wrapperRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Focus search when opening
  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus()
    }
  }, [open])

  const handleToggleFav = useCallback(
    (symbol: string, e: React.MouseEvent) => {
      e.stopPropagation()
      toggleFavorite(symbol)
    },
    [toggleFavorite]
  )

  const filteredPairs = useMemo(() => {
    let result = allPairs

    if (filter === 'favorites') {
      result = result.filter(p => isFavorite(p.symbol))
    } else if (filter === 'LUNES') {
      // Native-coin pairs: base is LUNES or WLUNES, or quote is LUNES
      result = result.filter(p => {
        const [base, quote] = p.symbol.split('/')
        return LUNES_ECOSYSTEM_BASES.includes(base) || quote === 'LUNES'
      })
    } else if (filter === 'LUSDT') {
      result = result.filter(p => p.quote === 'LUSDT')
    }

    if (search.trim()) {
      const q = search.trim().toUpperCase()
      result = result.filter(p => p.symbol.includes(q))
    }

    return result
  }, [allPairs, filter, isFavorite, search])

  const handleSelect = (pair: string) => {
    setSelected(pair)
    setSelectedPair(pair)
    onChange?.(pair)
    setOpen(false)
    setSearch('')
  }

  return (
    <Wrapper ref={wrapperRef}>
      <Button onClick={() => setOpen(o => !o)}>
        {selected}
        <Arrow open={open}>▼</Arrow>
      </Button>
      {open && (
        <Dropdown>
          <SearchInput
            ref={searchRef}
            placeholder="Search pairs..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <FilterTabs>
            <FilterTab
              active={filter === 'favorites'}
              onClick={() => setFilter('favorites')}
            >
              ★
            </FilterTab>
            <FilterTab
              active={filter === 'all'}
              onClick={() => setFilter('all')}
            >
              All
            </FilterTab>
            <FilterTab
              active={filter === 'LUNES'}
              onClick={() => setFilter('LUNES')}
            >
              LUNES
            </FilterTab>
            <FilterTab
              active={filter === 'LUSDT'}
              onClick={() => setFilter('LUSDT')}
            >
              LUSDT
            </FilterTab>
          </FilterTabs>
          <PairList>
            {filteredPairs.map(p => (
              <PairRow
                key={p.symbol}
                active={p.symbol === selected}
                onClick={() => handleSelect(p.symbol)}
              >
                <StarBtn
                  isFav={isFavorite(p.symbol)}
                  onClick={e => handleToggleFav(p.symbol, e)}
                >
                  ★
                </StarBtn>
                <PairName>{p.symbol}</PairName>
                <PriceCol>
                  <PairPrice>{formatPrice(p.price)}</PairPrice>
                  <PairVolume>Vol: {formatVolume(p.volume24h)}</PairVolume>
                </PriceCol>
                <PairChange positive={p.change24h >= 0}>
                  {p.change24h >= 0 ? '+' : ''}
                  {p.change24h.toFixed(2)}%
                </PairChange>
              </PairRow>
            ))}
            {filteredPairs.length === 0 && (
              <PairRow style={{ justifyContent: 'center', cursor: 'default' }}>
                <PairName
                  style={{
                    color: 'rgba(255,255,255,0.3)',
                    gridColumn: '1 / -1',
                    textAlign: 'center'
                  }}
                >
                  No pairs found
                </PairName>
              </PairRow>
            )}
          </PairList>
        </Dropdown>
      )}
    </Wrapper>
  )
}

export default PairSelector
