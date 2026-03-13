import React from 'react'
import styled, { css } from 'styled-components'
import { useNavigate } from 'react-router-dom'

type SubNavProps = {
  active?: boolean
}

const NavWrapper = styled.div`
  display: flex;
  align-items: center;
  width: 100%;
  border-bottom: 1px solid ${({ theme }) => theme.colors.themeColors[400]};
  margin-bottom: 8px;
`

const NavItem = styled.span<SubNavProps>`
  ${({ theme, active }) => css`
    flex: 1;
    height: 56px;
    font-size: 16px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-bottom: 2px solid ${active ? theme.colors.themeColors[800] : 'transparent'};
    color: ${active ? theme.colors.themeColors[100] : theme.colors.themeColors[200]};
    transition: color 0.2s, border-color 0.2s;
    margin-bottom: -1px;

    &:hover {
      color: ${theme.colors.themeColors[100]};
    }
  `}
`

const SettingsIcon = styled.img`
  padding: 8px;
  cursor: pointer;
  opacity: 0.7;

  &:hover {
    opacity: 1;
  }
`

interface TradeSubNavProps {
  active: 'swap' | 'pool' | 'staking'
  onSettingsClick?: () => void
}

const TradeSubNav: React.FC<TradeSubNavProps> = ({ active, onSettingsClick }) => {
  const navigate = useNavigate()

  return (
    <NavWrapper>
      <NavItem active={active === 'swap'} onClick={() => navigate('/swap')}>
        Swap
      </NavItem>
      <NavItem active={active === 'pool'} onClick={() => navigate('/pool')}>
        Liquidity pool
      </NavItem>
      <NavItem active={active === 'staking'} onClick={() => navigate('/staking')}>
        Staking
      </NavItem>
      <SettingsIcon src="/img/tab-bar.svg" alt="settings" onClick={onSettingsClick} />
    </NavWrapper>
  )
}

export default TradeSubNav
