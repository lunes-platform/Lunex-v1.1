import React, { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAppContext } from 'context/useContext'
import { useSDK } from '../../context/SDKContext'
import * as B from 'components/bases'
import * as S from './styles'
//Modals
import * as M from './modals'
import BalanceDropdown from './BalanceDropdown'
import { LunexLogo } from 'components/LunexLogo'

const Header = () => {
  const { state } = useAppContext()
  const sdk = useSDK()
  const navigate = useNavigate()
  const location = useLocation()
  const [modal, setModal] = useState('null')

  // Formatar endereço para exibição
  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

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
        <LunexLogo width="135px" navHome />

        {/* Governance and Rewards - moved from TabBar to header */}
        <S.NavLinks>
          <S.NavLink
            active={
              location.pathname === '/swap' || location.pathname === '/trade'
            }
            onClick={() => navigate('/swap')}
          >
            Swap
          </S.NavLink>
          <S.NavLink
            active={location.pathname === '/spot'}
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
            onClick={() => navigate('/pools')}
          >
            Liquidity Pool
          </S.NavLink>
          <S.NavLink
            active={
              location.pathname === '/staking' || location.pathname === '/stake'
            }
            onClick={() => navigate('/staking')}
          >
            Staking
          </S.NavLink>
          <S.NavLink
            active={location.pathname.startsWith('/social')}
            onClick={() => navigate('/social')}
          >
            Social Trade
          </S.NavLink>
          <S.NavLink
            active={location.pathname.startsWith('/strategies')}
            onClick={() => navigate('/strategies')}
          >
            Strategies
          </S.NavLink>
          <S.NavLink
            active={location.pathname === '/agent'}
            onClick={() => navigate('/agent')}
          >
            Agent
          </S.NavLink>
          <S.NavLink
            active={
              location.pathname === '/rewards' ||
              location.pathname === '/community'
            }
            onClick={() => navigate('/rewards')}
          >
            Rewards
          </S.NavLink>
          <S.NavLink
            active={
              location.pathname === '/affiliates' ||
              location.pathname === '/referral'
            }
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
                  onClick={() => navigate('/governance')}
                >
                  Governance
                </S.DropdownItem>
                <S.DropdownItem
                  active={location.pathname === '/protocol-stats'}
                  onClick={() => navigate('/protocol-stats')}
                >
                  Revenue
                </S.DropdownItem>
                <S.DropdownItem
                  active={location.pathname === '/docs'}
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
