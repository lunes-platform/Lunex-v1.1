import React, { useState, useEffect, useRef, useCallback } from 'react'
import styled, { css } from 'styled-components'
import { useSDK } from '../../context/SDKContext'
import tokens from '../home/modals/chooseToken/mock'

// ─── Styled Components ───────────────────────────────────────────

const Wrapper = styled.div`
  position: relative;
`

type TriggerProps = { $open: boolean }

const Trigger = styled.button<TriggerProps>`
  ${({ theme, $open }) => css`
    max-width: 140px;
    width: 100%;
    height: 40px;
    padding: 0 10px;
    font-size: 13px;
    font-weight: 400;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    border: none;
    border-radius: 0;
    background-color: ${theme.colors.themeColors[400]};
    color: ${theme.colors.themeColors[200]};
    transition: background 0.15s;

    &:hover {
      background-color: ${theme.colors.themeColors[300] ?? theme.colors.themeColors[400]};
    }

    svg {
      flex-shrink: 0;
      transition: transform 0.2s ease;
      transform: rotate(${$open ? '180deg' : '0deg'});
      opacity: 0.6;
    }
  `}
`

const Panel = styled.div`
  ${({ theme }) => css`
    position: absolute;
    top: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    width: 280px;
    background: ${theme.colors.themeColors[500]};
    border: 1px solid ${theme.colors.themeColors[400]};
    border-radius: 14px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
    z-index: 200;
    overflow: hidden;
    animation: fadeDown 0.15s ease;

    @keyframes fadeDown {
      from { opacity: 0; transform: translateX(-50%) translateY(-6px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
  `}
`

const PanelHeader = styled.div`
  ${({ theme }) => css`
    padding: 14px 16px 10px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: ${theme.colors.themeColors[200]};
    border-bottom: 1px solid ${theme.colors.themeColors[400]};
  `}
`

const TokenList = styled.div`
  max-height: 300px;
  overflow-y: auto;

  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb {
    background: ${({ theme }) => theme.colors.themeColors[400]};
    border-radius: 2px;
  }
`

type RowProps = { $zero: boolean }

const TokenRow = styled.div<RowProps>`
  ${({ theme, $zero }) => css`
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 16px;
    opacity: ${$zero ? 0.4 : 1};
    transition: background 0.15s;
    cursor: default;

    &:hover {
      background: ${theme.colors.themeColors[400]};
    }

    &:not(:last-child) {
      border-bottom: 1px solid ${theme.colors.themeColors[400]}44;
    }
  `}
`

const TokenIcon = styled.img`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  flex-shrink: 0;
  background: ${({ theme }) => theme.colors.themeColors[400]};
`

const TokenInfo = styled.div`
  flex: 1;
  min-width: 0;
`

const TokenSymbol = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.themeColors[100]};
`

const TokenName = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
  margin-top: 1px;
`

const TokenBalance = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  text-align: right;
  font-variant-numeric: tabular-nums;
`

const LoadingRow = styled.div`
  padding: 20px 16px;
  text-align: center;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
`

// ─── Helpers ─────────────────────────────────────────────────────

function formatCompact(value: number): string {
  if (value === 0) return '0'
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`
  return value.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

// ─── Component ───────────────────────────────────────────────────

interface TokenBalanceItem {
  acronym: string
  name: string
  icon: string
  balance: string
  rawBalance: number
}

const BalanceDropdown: React.FC = () => {
  const sdk = useSDK()
  const ref = useRef<HTMLDivElement>(null)

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [balances, setBalances] = useState<TokenBalanceItem[]>([])

  const nativeFormatted = sdk.isConnected
    ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(
      Number(sdk.balance || 0),
    )
    : '0'

  const fetchAllBalances = useCallback(async () => {
    if (!sdk.isConnected || !sdk.walletAddress) return
    setLoading(true)

    try {
      const results: TokenBalanceItem[] = []

      for (const token of tokens) {
        let raw = '0'

        if (token.isNative) {
          raw = sdk.balance || '0'
          const numRaw = Number(raw) / Math.pow(10, token.decimals)
          results.push({
            acronym: token.acronym,
            name: token.token,
            icon: token.icon,
            balance: formatCompact(numRaw),
            rawBalance: numRaw,
          })
        } else if (token.address) {
          try {
            raw = await sdk.getTokenBalance(token.address, sdk.walletAddress)
            const numRaw = Number(raw) / Math.pow(10, token.decimals)
            results.push({
              acronym: token.acronym,
              name: token.token,
              icon: token.icon,
              balance: formatCompact(numRaw),
              rawBalance: numRaw,
            })
          } catch {
            results.push({
              acronym: token.acronym,
              name: token.token,
              icon: token.icon,
              balance: '0',
              rawBalance: 0,
            })
          }
        }
      }

      // Sort: non-zero first
      results.sort((a, b) => b.rawBalance - a.rawBalance)
      setBalances(results)
    } finally {
      setLoading(false)
    }
  }, [sdk])

  // Fetch when opening the panel
  useEffect(() => {
    if (open) fetchAllBalances()
  }, [open, fetchAllBalances])

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <Wrapper ref={ref}>
      <Trigger
        $open={open}
        title={sdk.isConnected ? `${sdk.balance} LUNES` : '0 LUNES'}
        onClick={() => {
          if (!sdk.isConnected) return
          setOpen(prev => !prev)
        }}
      >
        {sdk.isConnected ? `${nativeFormatted} LUNES` : '0 LUNES'}
        {sdk.isConnected && (
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
            <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </Trigger>

      {open && (
        <Panel>
          <PanelHeader>Wallet balances</PanelHeader>
          <TokenList>
            {loading ? (
              <LoadingRow>Loading balances…</LoadingRow>
            ) : balances.length === 0 ? (
              <LoadingRow>No tokens found</LoadingRow>
            ) : (
              balances.map(t => (
                <TokenRow key={t.acronym} $zero={t.rawBalance === 0}>
                  <TokenIcon
                    src={t.icon}
                    alt={t.acronym}
                    onError={e => { (e.target as HTMLImageElement).src = '/img/lunes-green.svg' }}
                  />
                  <TokenInfo>
                    <TokenSymbol>{t.acronym}</TokenSymbol>
                    <TokenName>{t.name}</TokenName>
                  </TokenInfo>
                  <TokenBalance>{t.balance}</TokenBalance>
                </TokenRow>
              ))
            )}
          </TokenList>
        </Panel>
      )}
    </Wrapper>
  )
}

export default BalanceDropdown
