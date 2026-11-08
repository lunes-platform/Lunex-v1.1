import React from 'react'
import styled from 'styled-components'
import { C } from 'components/ui/kit'
import AnimatedNumber from 'components/ui/AnimatedNumber'
import { useSDK } from 'context/SDKContext'

/** LUNES native token has 8 decimals — `sdk.balance` is raw planck units. */
export const NATIVE_DECIMALS = 8

export const toNative = (raw?: string | number | null) =>
  Number(raw || 0) / Math.pow(10, NATIVE_DECIMALS)

/** Compact amount: 1.2M, 12.4K, 1,234, 12.34 */
export const fmtAmount = (n: number) => {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e4) return `${(n / 1e3).toFixed(1)}K`
  if (abs >= 1e3) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

const Amount = styled.span`
  color: ${C.muted};
  font-weight: 500;
`

/**
 * Native balance shown inside the account button on wide desktop
 * (prototype `headerBal`). Polled by SDKContext every 10s.
 */
const BalanceDropdown: React.FC = () => {
  const sdk = useSDK()
  const value = toNative(sdk.balance)
  return (
    <Amount
      title={`${value.toLocaleString('en-US', {
        maximumFractionDigits: 4
      })} LUNES`}
    >
      <AnimatedNumber text={`${fmtAmount(value)} LUNES`} />
    </Amount>
  )
}

export default BalanceDropdown
