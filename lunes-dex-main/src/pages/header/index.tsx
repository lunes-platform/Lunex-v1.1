import React, { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAppContext } from 'context/useContext'
import { useSDK } from '../../context/SDKContext'
import * as B from 'components/bases'
import * as S from './styles'
//Modals
import * as M from './modals'
import BalanceDropdown from './BalanceDropdown'

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

  // Handler para conectar wallet real
  const handleConnectWallet = async () => {
    setModal('connecting')
    try {
      await sdk.connectWallet()
      setModal('account')
    } catch (error) {
      console.error('Erro ao conectar:', error)
      setModal('null')
    }
  }

  // Handler para desconectar
  const handleDisconnect = () => {
    sdk.disconnectWallet()
    setModal('null')
  }

  return (
    <>
      <S.Header>
        <img src="/img/lunes-logo.svg" onClick={() => navigate('/')} style={{ cursor: 'pointer' }} />

        {/* Governance and Rewards - moved from TabBar to header */}
        <S.NavLinks>
          <S.NavLink
            active={location.pathname === '/swap' || location.pathname === '/trade'}
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
            active={location.pathname === '/pools' || location.pathname === '/pool' || location.pathname === '/liquidity'}
            onClick={() => navigate('/pools')}
          >
            Liquidity Pool
          </S.NavLink>
          <S.NavLink
            active={location.pathname === '/staking' || location.pathname === '/stake'}
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
            active={location.pathname === '/governance'}
            onClick={() => navigate('/governance')}
          >
            Governance
          </S.NavLink>
          <S.NavLink
            active={location.pathname === '/rewards' || location.pathname === '/community'}
            onClick={() => navigate('/rewards')}
          >
            Rewards
          </S.NavLink>
          <S.NavLink
            active={location.pathname === '/affiliates' || location.pathname === '/referral'}
            onClick={() => navigate('/affiliates')}
          >
            Affiliates
          </S.NavLink>
          <S.NavLink
            active={location.pathname === '/protocol-stats'}
            onClick={() => navigate('/protocol-stats')}
          >
            Revenue
          </S.NavLink>
          <S.NavLink
            active={location.pathname === '/docs'}
            onClick={() => navigate('/docs')}
          >
            Docs
          </S.NavLink>
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
            <BalanceDropdown />
            <S.Status
              style={{ fontSize: '13px' }}
              isPending={!!state.selectedOption1 && !!state.selectedOption2}
              onClick={() =>
                sdk.isConnected ? setModal('account') : setModal('connectWallet')
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
            onClick={() =>
              sdk.isConnected ? setModal('account') : setModal('connectWallet')
            }
            style={{ cursor: 'pointer' }}
          />
          <img
            src="/img/settings.svg"
            style={{ cursor: 'pointer' }}
            onClick={() => setModal(modal === 'settings' ? 'null' : 'settings')}
          />
        </S.Nav>
      </S.Header>

      {modal === 'settings' && (
        <M.Settings close={() => setModal('null')} />
      )}

      {modal === 'connectWallet' && (
        <M.ModalConnectWallet
          connectNetwork={handleConnectWallet}
          connectWallet={handleConnectWallet}
          close={() => setModal('null')}
        />
      )}

      {modal === 'connecting' && (
        <M.Connecting close={() => setModal('null')} />
      )}

      {modal === 'account' && (
        <M.Account
          disconnect={handleDisconnect}
          change={() => setModal('connectWallet')}
          close={() => setModal('null')}
          statusTransaction={() => setModal('statusTransaction')}
        />
      )}

      {modal === 'statusTransaction' && (
        <M.StatusTransaction close={() => setModal('null')} />
      )}
    </>
  )
}

export default Header
