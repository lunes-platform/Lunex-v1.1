import styled from 'styled-components'
import { C, MainCard, grotesk, tabular } from 'components/ui/kit'
import { fadeIn, spin } from 'styles/motion'

/** Swap card: page-coloured body with the static purple glow (prototype). */
export const SwapCard = styled(MainCard)`
  background: ${C.bg};
  gap: 4px;
  position: relative;
`

export const CardHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  h1 {
    ${grotesk};
    font-size: 22px;
    font-weight: 600;
  }
`

export const SettingsBtn = styled.button<{ $open: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1px solid ${p => (p.$open ? C.primary : C.borderStrong)};
  background: transparent;
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  ${tabular};
  &:hover {
    border-color: ${C.primary};
  }
`

export const AmountPanel = styled.div<{ $error?: boolean }>`
  background: ${C.surface};
  border: 1px solid ${p => (p.$error ? 'rgba(255,93,105,0.6)' : C.border)};
  border-radius: 16px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition:
    border-color 200ms ease,
    box-shadow 150ms ease;
  &:focus-within {
    border-color: ${p => (p.$error ? 'rgba(255,93,105,0.6)' : C.borderStrong)};
  }
`

export const PanelTop = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: ${C.muted};
  min-height: 24px;
  ${tabular};
`

export const Label = styled.span<{ $error?: boolean }>`
  color: ${p => (p.$error ? C.criticalText2 : C.muted)};
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: color 200ms ease;
`

export const BalRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  white-space: nowrap;
`

export const MiniBtn = styled.button<{ $solid?: boolean }>`
  height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid ${p => (p.$solid ? 'transparent' : C.borderStrong)};
  background: ${p => (p.$solid ? C.primary : 'transparent')};
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  &:hover {
    border-color: ${p => (p.$solid ? 'transparent' : C.primary)};
    background: ${p => (p.$solid ? C.primaryHover : 'transparent')};
  }
`

export const AmountRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const amountText = `
  flex: 1;
  min-width: 0;
  font-family: 'Space Grotesk', 'Inter', sans-serif;
  font-size: 32px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  padding: 0;
  @media (max-width: 759px) {
    font-size: 26px;
  }
`

export const AmountInput = styled.input<{ $error?: boolean }>`
  ${amountText};
  background: transparent;
  border: none;
  outline: none;
  color: ${p => (p.$error ? C.criticalText : '#fff')};
  transition: color 200ms ease;
  &::placeholder {
    color: #6d6d6d;
  }
`

export const AmountOut = styled.div<{ $empty: boolean; $dim: boolean }>`
  ${amountText};
  color: ${p => (p.$empty ? '#6D6D6D' : '#fff')};
  opacity: ${p => (p.$dim ? 0.45 : 1)};
  transition: opacity 200ms ease;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

export const TokenPill = styled.button<{ $empty?: boolean }>`
  ${grotesk};
  display: flex;
  align-items: center;
  gap: 8px;
  height: 42px;
  padding: ${p => (p.$empty ? '0 10px 0 14px' : '0 10px 0 6px')};
  border-radius: 999px;
  background: ${p => (p.$empty ? C.primary : C.field)};
  border: 1px solid ${p => (p.$empty ? 'transparent' : C.borderStrong)};
  color: #fff;
  font-weight: 600;
  font-size: 16px;
  flex-shrink: 0;
  white-space: nowrap;
  transition:
    border-color 150ms ease,
    background-color 150ms ease;
  &:hover {
    border-color: ${C.primary};
    background: ${p => (p.$empty ? C.primaryHover : C.field)};
  }
`

export const PanelBottom = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
  color: ${C.muted};
  ${tabular};
`

export const PayError = styled.span`
  color: ${C.criticalText2};
  font-weight: 500;
  animation: ${fadeIn} 200ms ease;
`

export const FlipWrap = styled.div`
  display: flex;
  justify-content: center;
  height: 0;
  position: relative;
  z-index: 2;
`

export const FlipBtn = styled.button<{ $deg: number }>`
  position: absolute;
  top: -20px;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 4px solid ${C.bg};
  background: ${C.field};
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: rotate(${p => p.$deg}deg);
  transition:
    transform 400ms cubic-bezier(0.2, 0.8, 0.2, 1),
    background-color 150ms ease;
  &:hover:not(:disabled) {
    background: ${C.primary};
  }
  &:disabled {
    color: ${C.muted};
    cursor: not-allowed;
  }
`

export const ReceivePanel = styled(AmountPanel)`
  margin-top: 4px;
`

export const QuoteSpinner = styled.span`
  width: 12px;
  height: 12px;
  border: 2px solid rgba(173, 135, 255, 0.3);
  border-top-color: ${C.primaryText};
  border-radius: 50%;
  display: inline-block;
  animation: ${spin} 0.7s linear infinite;
`

export const Details = styled.div<{ $dim: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 4px 4px;
  opacity: ${p => (p.$dim ? 0.45 : 1)};
  transition: opacity 200ms ease;
  animation: ${fadeIn} 200ms ease both;
`

export const RateBtn = styled.button`
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 6px 0;
  border: none;
  background: transparent;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  text-align: left;
  ${tabular};
`

export const DetailLine = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  padding: 6px 0;
  font-size: 13px;
  > span:first-child {
    color: ${C.muted};
    cursor: default;
  }
  > span:last-child {
    font-weight: 500;
    text-align: right;
    ${tabular};
  }
`

export const ImpactWarn = styled.div`
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px;
  border-radius: 12px;
  background: rgba(255, 40, 76, 0.1);
  border: 1px solid rgba(255, 93, 105, 0.35);
  color: ${C.criticalText2};
  font-size: 13px;
  line-height: 1.5;
  margin-top: 4px;
  animation: ${fadeIn} 200ms ease both;
  svg {
    flex-shrink: 0;
    margin-top: 1px;
  }
`

export const QuoteError = styled.div`
  font-size: 13px;
  color: ${C.warning};
  padding: 10px 4px 0;
`

export const Cta = styled.div`
  margin-top: 12px;
  button {
    border-radius: 16px;
  }
`

export const Footer = styled.p`
  text-align: center;
  font-size: 12px;
  color: ${C.muted};
  line-height: 1.5;
`
