import React, { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bell as BellIcon, ChevronDown, SlidersHorizontal } from 'lucide-react'
import { short } from 'components/ui/kit'
import { LunexLogo } from 'components/LunexLogo'
import { useNotifications } from 'components/feedback/ToastProvider'
import { useSDK } from 'context/SDKContext'
import { useTx } from 'context/TxContext'
import { useIsMobile, useIsTablet } from 'hooks/useMediaQuery'
import BalanceDropdown from './BalanceDropdown'
import {
  AccountPanel,
  NotificationPanel,
  SettingsMenu,
  WalletModal
} from './modals'
import { OPEN_WALLET_EVENT } from './modals/wallets'
import { MORE_NAV, PRIMARY_NAV, activePrimary, inMore, isActive } from './nav'
import * as S from './styles'

type Menu = 'more' | 'notif' | 'settings' | 'account' | null

const Header: React.FC = () => {
  const sdk = useSDK()
  const tx = useTx()
  const notifs = useNotifications()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const mobile = useIsMobile()
  const tablet = useIsTablet()
  const wide = !mobile && !tablet

  const [menu, setMenu] = useState<Menu>(null)
  const [walletOpen, setWalletOpen] = useState(false)
  const rootRef = useRef<HTMLElement>(null)

  const toggle = (m: Exclude<Menu, null>) =>
    setMenu(cur => (cur === m ? null : m))
  const close = () => setMenu(null)

  // Close menus on route change.
  useEffect(() => {
    setMenu(null)
  }, [pathname])

  // Outside click + Esc.
  useEffect(() => {
    if (!menu) return
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  // Any screen can ask for the connect modal (see modals/wallets.ts).
  useEffect(() => {
    const open = () => {
      setMenu(null)
      setWalletOpen(true)
    }
    window.addEventListener(OPEN_WALLET_EVENT, open)
    return () => window.removeEventListener(OPEN_WALLET_EVENT, open)
  }, [])

  // Account panel makes no sense once disconnected.
  useEffect(() => {
    if (!sdk.isConnected) setMenu(m => (m === 'account' ? null : m))
  }, [sdk.isConnected])

  const go = (to: string) => {
    navigate(to)
    setMenu(null)
  }

  const primary = activePrimary(pathname)
  const moreActive = inMore(pathname)
  const hasPending = tx.pendingCount > 0
  const unread = notifs.unread
  const connected = sdk.isConnected && !!sdk.walletAddress

  return (
    <>
      <S.Header ref={rootRef}>
        <S.LogoButton onClick={() => navigate('/')} aria-label="Lunex home">
          <LunexLogo height="20px" />
        </S.LogoButton>

        {!mobile && (
          <S.Nav aria-label="Primary">
            {PRIMARY_NAV.map(n => (
              <S.NavButton
                key={n.key}
                $active={primary === n.key}
                aria-current={primary === n.key ? 'page' : undefined}
                onClick={() => go(n.to)}
              >
                {n.label}
              </S.NavButton>
            ))}
            <S.Anchor>
              <S.NavButton
                $active={moreActive}
                aria-haspopup="menu"
                aria-expanded={menu === 'more'}
                onClick={() => toggle('more')}
                style={{ padding: '8px 12px' }}
              >
                More
                <ChevronDown size={14} strokeWidth={2} />
              </S.NavButton>
              {menu === 'more' && (
                <S.Popover
                  $width={240}
                  $align="left"
                  $pad={6}
                  role="menu"
                  aria-label="More"
                  style={{ gap: 2 }}
                >
                  {MORE_NAV.map(m => (
                    <S.MenuItem
                      key={m.key}
                      role="menuitem"
                      aria-current={isActive(m, pathname) ? 'page' : undefined}
                      onClick={() => go(m.to)}
                    >
                      {m.label}
                      <span>{m.note}</span>
                    </S.MenuItem>
                  ))}
                </S.Popover>
              )}
            </S.Anchor>
          </S.Nav>
        )}

        <S.Right>
          {hasPending && (
            <S.PendingChip
              onClick={tx.show}
              aria-label={`${tx.pendingCount} pending transaction${tx.pendingCount > 1 ? 's' : ''} — show progress`}
            >
              <S.ChipSpinner />
              {tx.pendingCount} pending
            </S.PendingChip>
          )}

          {wide && !hasPending && (
            <S.NetChip aria-label="Network: Lunes">
              <i aria-hidden />
              Lunes
            </S.NetChip>
          )}

          <S.Anchor>
            <S.HeaderIconButton
              $active={menu === 'notif'}
              aria-label={
                unread ? `Notifications, ${unread} unread` : 'Notifications'
              }
              aria-expanded={menu === 'notif'}
              onClick={() => toggle('notif')}
            >
              <S.Bell key={notifs.bellRing} $ring={notifs.bellRing}>
                <BellIcon size={18} strokeWidth={1.75} />
              </S.Bell>
              {unread > 0 && (
                <S.CountBadge aria-hidden>
                  {unread > 9 ? '9+' : unread}
                </S.CountBadge>
              )}
            </S.HeaderIconButton>
            {menu === 'notif' && <NotificationPanel onClose={close} />}
          </S.Anchor>

          <S.Anchor>
            <S.HeaderIconButton
              $active={menu === 'settings'}
              aria-label="Settings"
              aria-haspopup="menu"
              aria-expanded={menu === 'settings'}
              onClick={() => toggle('settings')}
            >
              <SlidersHorizontal size={18} strokeWidth={1.75} />
            </S.HeaderIconButton>
            {menu === 'settings' && <SettingsMenu onClose={close} />}
          </S.Anchor>

          {!connected ? (
            <S.ConnectButton
              onClick={() => {
                setMenu(null)
                setWalletOpen(true)
              }}
            >
              {mobile ? 'Connect' : 'Connect wallet'}
            </S.ConnectButton>
          ) : (
            <S.Anchor>
              <S.AccountButton
                $active={menu === 'account'}
                aria-label={`Account ${short(sdk.walletAddress)}`}
                aria-expanded={menu === 'account'}
                onClick={() => toggle('account')}
              >
                <img src="/img/lunes-green.svg" alt="" />
                {wide && <BalanceDropdown />}
                {!mobile && (
                  <>
                    <span>{short(sdk.walletAddress)}</span>
                    <ChevronDown size={14} strokeWidth={2} color="#8A8A8E" />
                  </>
                )}
              </S.AccountButton>
              {menu === 'account' && <AccountPanel onClose={close} />}
            </S.Anchor>
          )}
        </S.Right>
      </S.Header>

      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
    </>
  )
}

export default Header
