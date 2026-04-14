import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import * as S from './styles'

const TabBar = () => {
  const navigate = useNavigate()
  const location = useLocation()

  const menus = [
    { id: 1, menu: 'Ecosystem', path: null, disabled: true },
    { id: 2, menu: 'Trade', path: '/swap', disabled: false }
  ]

  // Determine active menu based on current path
  const getActiveMenu = () => {
    const path = location.pathname
    if (
      path === '/' ||
      path === '/swap' ||
      path === '/pool' ||
      path === '/staking'
    )
      return 2
    return 2
  }

  const activeMenu = getActiveMenu()

  const handleMenuClick = (menu: (typeof menus)[0]) => {
    if (menu.disabled || !menu.path) return
    navigate(menu.path)
  }

  return (
    <S.Container direction radius bg={500}>
      {menus.map(menu => {
        return (
          <S.Span
            key={menu.id}
            active={menu.id === activeMenu}
            onClick={() => handleMenuClick(menu)}
            title={menu.disabled ? 'Coming soon' : ''}
            style={{
              cursor: menu.disabled ? 'not-allowed' : 'pointer',
              opacity: menu.disabled ? 0.5 : 1
            }}
          >
            {menu.menu}
          </S.Span>
        )
      })}
    </S.Container>
  )
}

export default TabBar
