import React from 'react'
import styled, { css } from 'styled-components'
import { useSDK } from '../../context/SDKContext'

// ─── Styled Components ───────────────────────────────────────────

const Wrapper = styled.div`
  position: relative;
`

const Trigger = styled.button`
  ${({ theme }) => css`
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
      background-color: ${theme.colors.themeColors[300] ??
      theme.colors.themeColors[400]};
    }

    svg {
      flex-shrink: 0;
      opacity: 0.6;
    }
  `}
`

const BalanceDropdown: React.FC<{
  onConnectRequest?: () => void
  onOpenWallet?: () => void
}> = ({ onConnectRequest, onOpenWallet }) => {
  const sdk = useSDK()

  // LUNES native token has 8 decimals — sdk.balance returns raw planck units
  const NATIVE_DECIMALS = 8

  // Abbreviate the native balance for the trigger button
  const nativeFormatted = (() => {
    const raw = Number(sdk.balance || 0)
    if (!sdk.isConnected || raw === 0) return '0'
    // Convert from planck units to human-readable LUNES
    const humanValue = raw / Math.pow(10, NATIVE_DECIMALS)
    const abs = Math.abs(humanValue)
    if (abs >= 1e12) return `${(abs / 1e12).toFixed(1)}T`
    if (abs >= 1e9) return `${(abs / 1e9).toFixed(1)}B`
    if (abs >= 1e6) return `${(abs / 1e6).toFixed(1)}M`
    if (abs >= 10e3) return `${(abs / 1e3).toFixed(1)}K`
    if (abs >= 1e3)
      return abs.toLocaleString('en-US', { maximumFractionDigits: 0 })
    return abs.toFixed(2)
  })()

  return (
    <Wrapper>
      <Trigger
        title={
          sdk.isConnected
            ? `${(
                Number(sdk.balance || 0) / Math.pow(10, NATIVE_DECIMALS)
              ).toLocaleString('en-US', { maximumFractionDigits: 4 })} LUNES`
            : 'Click to connect wallet'
        }
        onClick={() => {
          if (!sdk.isConnected) {
            onConnectRequest?.()
            return
          }
          onOpenWallet?.()
        }}
      >
        {sdk.isConnected ? `${nativeFormatted} LUNES` : '0 LUNES'}
        {sdk.isConnected && (
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
            <path
              d="M1 1L5 5L9 1"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </Trigger>
    </Wrapper>
  )
}

export default BalanceDropdown
