import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAppContext } from 'context/useContext'
import { useSDK } from '../../context/SDKContext'
import * as B from 'components/bases'
import * as S from './styles'
//Modals
import * as M from './modals'
import BalanceDropdown from './BalanceDropdown'
import { LunexLogo } from 'components/LunexLogo'
import { prefetchRoute } from 'routers/prefetch'

type NavItem = {
  label: string
  path: string
  isActive: (pathname: string) => boolean
}

// Single source of truth for primary nav items (desktop + mobile drawer)
const NAV_ITEMS: NavItem[] = [
  {
    label: 'Swap',
    path: '/swap',
    isActive: p => p === '/swap' || p === '/trade'
  },
  { label: 'Spot', path: '/spot', isActive: p => p === '/spot' },
  {
    label: 'Liquidity Pool',
    path: '/pools',
    isActive: p => p === '/pools' || p === '/pool' || p === '/liquidity'
  },
  {
    label: 'Staking',
    path: '/staking',
    isActive: p => p === '/staking' || p === '/stake'
  },
  {
    label: 'Social Trade',
    path: '/social',
    isActive: p => p.startsWith('/social')
  },
  {
    label: 'Strategies',
    path: '/strategies',
    isActive: p => p.startsWith('/strategies')
  },
  { label: 'Agent', path: '/agent', isActive: p => p === '/agent' },
  {
    label: 'Rewards',
    path: '/rewards',
    isActive: p => p === '/rewards' || p === '/community'
  },
  {
    label: 'Affiliates',
    path: '/affiliates',
    isActive: p => p === '/affiliates' || p === '/referral'
  },
  {
    label: 'Governance',
    path: '/governance',
    isActive: p => p === '/governance'
  },
  {
    label: 'Revenue',
    path: '/protocol-stats',
    isActive: p => p === '/protocol-stats'
  },
  { label: 'Docs', path: '/docs', isActive: p => p === '/docs' }
]

const Header = () => {
  const { state } = useAppContext()
  const sdk = useSDK()
  const navigate = useNavigate()
  const location = useLocation()
  const [modal, setModal] = useState('null')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Formatar endereço para exibição
  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  // Close mobile drawer on Escape
  useEffect(() => {
    if (!mobileNavOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mobileNavOpen])

  // Close connectWallet modal and open account when connection succeeds
  useEffect(() => {
    if (sdk.isConnected && modal === 'connectWallet') {
      setModal('account')
    }
  }, [sdk.isConnected]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handler para conectar wallet — apenas delega ao SDK
  // O modal fica aberto mostrando sdk.error em caso de falha
  const handleConnectWallet = async (walletSource?: string) => {
    await sdk.connectWallet(walletSource)
  }

  // Handler para desconectar
  const handleDisconnect = () => {
    sdk.disconnectWallet()
    setModal('null')
  }

  return (
    <>
      <S.Header>
        <S.HamburgerButton
          type="button"
          aria-label="Open navigation menu"
          aria-expanded={mobileNavOpen}
          onClick={() => setMobileNavOpen(true)}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </S.HamburgerButton>

        <LunexLogo width="135px" navHome />

        {/* Governance and Rewards - moved from TabBar to header */}
        <S.NavLinks>
          <S.NavLink
            active={
              location.pathname === '/swap' || location.pathname === '/trade'
            }
            onMouseEnter={() => prefetchRoute('/swap')}
            onClick={() => navigate('/swap')}
          >
            Swap
          </S.NavLink>
          <S.NavLink
            active={location.pathname === '/spot'}
            onMouseEnter={() => prefetchRoute('/spot')}
            onClick={() => navigate('/spot')}
          >
            Spot
          </S.NavLink>
          <S.NavLink
            active={
              location.pathname === '/pools' ||
              location.pathname === '/pool' ||
              location.pathname === '/liquidity'
            }
            onMouseEnter={() => prefetchRoute('/pools')}
            onClick={() => navigate('/pools')}
          >
            Liquidity Pool
          </S.NavLink>
          <S.NavLink
            active={
              location.pathname === '/staking' || location.pathname === '/stake'
            }
            onMouseEnter={() => prefetchRoute('/staking')}
            onClick={() => navigate('/staking')}
          >
            Staking
          </S.NavLink>
          <S.NavLink
            active={location.pathname.startsWith('/social')}
            onMouseEnter={() => prefetchRoute('/social')}
            onClick={() => navigate('/social')}
          >
            Social Trade
          </S.NavLink>
          <S.NavLink
            active={location.pathname.startsWith('/strategies')}
            onMouseEnter={() => prefetchRoute('/strategies')}
            onClick={() => navigate('/strategies')}
          >
            Strategies
          </S.NavLink>
          <S.NavLink
            active={location.pathname === '/agent'}
            onMouseEnter={() => prefetchRoute('/agent')}
            onClick={() => navigate('/agent')}
          >
            Agent
          </S.NavLink>
          <S.NavLink
            active={
              location.pathname === '/rewards' ||
              location.pathname === '/community'
            }
            onMouseEnter={() => prefetchRoute('/rewards')}
            onClick={() => navigate('/rewards')}
          >
            Rewards
          </S.NavLink>
          <S.NavLink
            active={
              location.pathname === '/affiliates' ||
              location.pathname === '/referral'
            }
            onMouseEnter={() => prefetchRoute('/affiliates')}
            onClick={() => navigate('/affiliates')}
          >
            Affiliates
          </S.NavLink>

          <S.DropdownContainer>
            <S.NavLink
              active={['/governance', '/protocol-stats', '/docs'].includes(
                location.pathname
              )}
            >
              More
              <svg
                width="10"
                height="6"
                viewBox="0 0 10 6"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M1 1L5 5L9 1"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </S.NavLink>
            <S.DropdownMenu>
              <S.DropdownContent>
                <S.DropdownItem
                  active={location.pathname === '/governance'}
                  onMouseEnter={() => prefetchRoute('/governance')}
                  onClick={() => navigate('/governance')}
                >
                  Governance
                </S.DropdownItem>
                <S.DropdownItem
                  active={location.pathname === '/protocol-stats'}
                  onMouseEnter={() => prefetchRoute('/protocol-stats')}
                  onClick={() => navigate('/protocol-stats')}
                >
                  Revenue
                </S.DropdownItem>
                <S.DropdownItem
                  active={location.pathname === '/docs'}
                  onMouseEnter={() => prefetchRoute('/docs')}
                  onClick={() => navigate('/docs')}
                >
                  Docs
                </S.DropdownItem>
              </S.DropdownContent>
            </S.DropdownMenu>
          </S.DropdownContainer>
        </S.NavLinks>

        <S.Nav>
          <B.Wrapper
            direction
            overflow
            radius
            bg="transparent"
            width="240px"
            height="40px"
          >
            <BalanceDropdown
              onConnectRequest={() => setModal('connectWallet')}
              onOpenWallet={() => setModal('account')}
            />
            <S.Status
              style={{ fontSize: '13px' }}
              isPending={!!state.selectedOption1 && !!state.selectedOption2}
              onClick={() =>
                sdk.isConnected
                  ? setModal('account')
                  : setModal('connectWallet')
              }
            >
              {!!state.selectedOption1 && !!state.selectedOption2
                ? '1 Pending'
                : sdk.isConnected && sdk.walletAddress
                  ? formatAddress(sdk.walletAddress)
                  : 'Connect wallet'}
            </S.Status>
          </B.Wrapper>
          <img
            src="/img/wallet.svg"
            alt="Wallet"
            style={{ cursor: 'pointer' }}
            onClick={() =>
              sdk.isConnected ? setModal('account') : setModal('connectWallet')
            }
          />
          <img
            src="/img/settings.svg"
            alt="Settings"
            style={{ cursor: 'pointer' }}
            onClick={() => setModal(modal === 'settings' ? 'null' : 'settings')}
          />
        </S.Nav>
      </S.Header>

      {mobileNavOpen && (
        <>
          <S.MobileNavOverlay onClick={() => setMobileNavOpen(false)} />
          <S.MobileNavDrawer aria-label="Main navigation">
            <S.MobileNavHeader>
              <LunexLogo width="120px" navHome />
              <S.MobileNavClose
                type="button"
                aria-label="Close navigation menu"
                onClick={() => setMobileNavOpen(false)}
              >
                ✕
              </S.MobileNavClose>
            </S.MobileNavHeader>
            {NAV_ITEMS.map(item => (
              <S.MobileNavLink
                key={item.path}
                active={item.isActive(location.pathname)}
                onMouseEnter={() => prefetchRoute(item.path)}
                onClick={() => {
                  navigate(item.path)
                  setMobileNavOpen(false)
                }}
              >
                {item.label}
              </S.MobileNavLink>
            ))}
          </S.MobileNavDrawer>
        </>
      )}

      {modal === 'settings' && <M.Settings close={() => setModal('null')} />}

      {modal === 'connectWallet' && (
        <M.ModalConnectWallet
          connectNetwork={(walletSource?: string) =>
            handleConnectWallet(walletSource)
          }
          connectWallet={(walletSource?: string) =>
            handleConnectWallet(walletSource)
          }
          close={() => setModal('null')}
        />
      )}

      {modal === 'connecting' && (
        <M.Connecting close={() => setModal('null')} />
      )}

      {modal === 'account' && (
        <M.WalletModal
          onClose={() => setModal('null')}
          onDisconnect={handleDisconnect}
        />
      )}

      {modal === 'statusTransaction' && (
        <M.StatusTransaction close={() => setModal('null')} />
      )}
    </>
  )
}

export default Header
