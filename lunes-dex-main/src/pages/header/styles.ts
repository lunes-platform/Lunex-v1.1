import styled, { css } from 'styled-components'
import { C, EASE_OUT, grotesk, tabular } from 'components/ui/kit'
import { bellRing, modalEnter, pop, spin } from 'styles/motion'

export const Header = styled.header`
  position: sticky;
  top: 0;
  z-index: 30;
  height: 64px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 0 24px;
  background: ${C.surface};
  border-bottom: 1px solid ${C.border};
  @media (max-width: 759px) {
    padding: 0 16px;
    gap: 12px;
  }
`

export const LogoButton = styled.button`
  background: none;
  border: none;
  padding: 0;
  display: flex;
  flex-shrink: 0;
  border-radius: 6px;
`

export const Nav = styled.nav`
  display: flex;
  gap: 2px;
  align-items: center;
`

export const NavButton = styled.button<{ $active?: boolean }>`
  ${grotesk};
  padding: 8px 14px;
  border: none;
  border-radius: 10px;
  background: ${p => (p.$active ? C.field : 'transparent')};
  color: ${p => (p.$active ? C.text : C.muted)};
  font-weight: 600;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  transition:
    color 150ms ease,
    background-color 150ms ease;
  &:hover {
    color: ${C.text};
  }
  svg {
    transition: transform 200ms ${EASE_OUT};
  }
  &[aria-expanded='true'] svg {
    transform: rotate(180deg);
  }
`

export const Anchor = styled.div`
  position: relative;
`

export const Right = styled.div`
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  @media (max-width: 759px) {
    gap: 6px;
  }
`

const popoverBase = css`
  background: ${C.surface};
  border: 1px solid ${C.border};
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
  z-index: 40;
  display: flex;
  flex-direction: column;
  animation: ${modalEnter} 200ms ${EASE_OUT} both;
`

/** Dropdown under a header control. `$mobileFixed` pins it under the header. */
export const Popover = styled.div<{
  $width: number
  $align?: 'left' | 'right'
  $pad?: number
  $mobileFixed?: boolean
}>`
  ${popoverBase};
  position: absolute;
  top: calc(100% + 8px);
  ${p => (p.$align === 'left' ? 'left: 0;' : 'right: 0;')}
  width: ${p => p.$width}px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 90px);
  overflow-y: auto;
  border-radius: ${p => (p.$width <= 240 ? 12 : 16)}px;
  padding: ${p => p.$pad ?? 0}px;
  ${p =>
    p.$mobileFixed &&
    css`
      @media (max-width: 759px) {
        position: fixed;
        top: 72px;
        left: 12px;
        right: 12px;
        width: auto;
        max-width: none;
      }
    `}
`

export const MenuItem = styled.button`
  ${grotesk};
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: ${C.text};
  font-weight: 500;
  font-size: 14px;
  text-align: left;
  &:hover,
  &:focus-visible {
    background: ${C.field};
  }
  &[aria-current='page'] {
    background: rgba(108, 56, 255, 0.12);
  }
  span {
    font-family: 'Inter', sans-serif;
    font-size: 12px;
    color: ${C.muted};
  }
`

export const PendingChip = styled.button`
  ${grotesk};
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid ${C.primaryBorder};
  background: rgba(108, 56, 255, 0.14);
  color: ${C.primaryText2};
  font-weight: 600;
  font-size: 13px;
  white-space: nowrap;
  animation: ${pop} 300ms ease both;
  ${tabular};
`

export const ChipSpinner = styled.span.attrs({
  'data-motion': 'pulse',
  'aria-hidden': true
})`
  width: 14px;
  height: 14px;
  border: 2px solid rgba(202, 175, 255, 0.35);
  border-top-color: ${C.primaryText2};
  border-radius: 50%;
  animation: ${spin} 0.7s linear infinite;
`

export const NetChip = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  background: ${C.bg};
  border: 1px solid ${C.border};
  font-size: 13px;
  color: ${C.text};
  font-weight: 500;
  white-space: nowrap;
  i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${C.success};
  }
`

export const HeaderIconButton = styled.button<{ $active?: boolean }>`
  position: relative;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid ${p => (p.$active ? C.primary : C.borderStrong)};
  background: transparent;
  color: ${C.text};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: border-color 150ms ease;
  &:hover {
    border-color: ${C.primary};
  }
`

export const Bell = styled.span<{ $ring: number }>`
  display: flex;
  transform-origin: top center;
  ${p =>
    p.$ring > 0 &&
    css`
      animation: ${bellRing} 700ms ease;
    `}
`

export const CountBadge = styled.span`
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 19px;
  height: 19px;
  padding: 0 5px;
  border-radius: 999px;
  background: ${C.primary};
  border: 2px solid ${C.surface};
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: ${pop} 350ms ease both;
  ${tabular};
`

export const ConnectButton = styled.button`
  ${grotesk};
  height: 40px;
  padding: 0 16px;
  border: none;
  border-radius: 12px;
  background: ${C.primary};
  color: #fff;
  font-weight: 600;
  font-size: 14px;
  white-space: nowrap;
  transition: background-color 150ms ease;
  &:hover {
    background: ${C.primaryHover};
  }
  @media (max-width: 759px) {
    padding: 0 12px;
    font-size: 13px;
  }
`

export const AccountButton = styled.button<{ $active?: boolean }>`
  ${grotesk};
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 10px 0 6px;
  border-radius: 12px;
  background: ${C.field};
  border: 1px solid ${p => (p.$active ? C.primary : C.borderStrong)};
  color: ${C.text};
  font-weight: 600;
  font-size: 14px;
  white-space: nowrap;
  transition: border-color 150ms ease;
  &:hover {
    border-color: ${C.primary};
  }
  img {
    width: 26px;
    height: 26px;
  }
  @media (max-width: 759px) {
    padding: 0 6px;
  }
`
