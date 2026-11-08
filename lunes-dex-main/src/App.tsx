import Header from 'pages/header'
import React from 'react'
import styled from 'styled-components'
import { BrowserRouter, useLocation } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { SpotProvider } from 'context/SpotContext'
import { TxProvider } from 'context/TxContext'
import { ToastProvider } from 'components/feedback/ToastProvider'
import TxProgressModal from 'components/feedback/TxProgressModal'
import FillNotifier from 'components/feedback/FillNotifier'
import DesktopUpdateNotifier from 'components/feedback/DesktopUpdateNotifier'
import SystemBanner from 'components/feedback/SystemBanner'
import MobileTabBar from 'pages/header/MobileTabBar'
import AppRoutes from 'routers'
import ErrorBoundary from 'components/ErrorBoundary'
import { FeedbackButton } from 'components/feedback/FeedbackModal'
import TestnetDisclaimer from 'components/feedback/TestnetDisclaimer'
import { useSDK } from 'context/SDKContext'
import { useTx } from 'context/TxContext'
import { NETWORK } from './config/contracts'
import { initTelemetry } from 'services/telemetry'

// Window error / unhandledrejection reporting (+ Sentry when a DSN is set).
initTelemetry()

/**
 * App shell (redesign):
 *   sticky header (64px) → system banner (sticky top 64) → <main> → mobile
 *   tab bar (sticky bottom). The landing ("/") is full-bleed, no shell.
 *   Main padding: 40px 24px 32px desktop, 20px 16px 32px mobile, 0 on Spot.
 */
const Shell = styled.div`
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #1a1a1a;
`

const Main = styled.main<{ $flush: boolean }>`
  flex: 1;
  width: 100%;
  padding: ${p => (p.$flush ? '0' : '40px 24px 32px')};
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 24px;
  @media (max-width: 759px) {
    padding: ${p => (p.$flush ? '0' : '20px 16px 32px')};
  }
`

const Footer = styled.div`
  margin: auto auto 0;
  padding-top: 24px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  color: #8a8a8e;
  text-align: center;
  span {
    color: #ad87ff;
    font-weight: 600;
  }
  @media (max-width: 759px) {
    display: none;
  }
`

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/

/** Floating "Report a bug" with the opt-in context (wallet, last tx hash). */
const FeedbackLauncher: React.FC<{ bottomOffset?: number }> = ({
  bottomOffset
}) => {
  const { walletAddress } = useSDK()
  const { activity } = useTx()
  const lastTxHash = activity.find(a => a.hash && TX_HASH_RE.test(a.hash))?.hash
  return (
    <FeedbackButton
      walletAddress={walletAddress}
      lastTxHash={lastTxHash}
      bottomOffset={bottomOffset}
    />
  )
}

const AppFrame: React.FC = () => {
  const { pathname } = useLocation()
  if (pathname === '/')
    return (
      <>
        <AppRoutes />
        <SystemBanner placement="bottom" />
        <FeedbackLauncher
          bottomOffset={NETWORK.name !== 'mainnet' ? 72 : undefined}
        />
      </>
    )
  const flush = pathname.startsWith('/spot') && pathname === '/spot'
  return (
    <Shell>
      <Header />
      <SystemBanner />
      <Main $flush={flush}>
        <AppRoutes />
        {!flush && (
          <Footer>
            <span>Lunex:</span> developed on the Lunes blockchain
          </Footer>
        )}
      </Main>
      <MobileTabBar />
      <FeedbackLauncher />
    </Shell>
  )
}

const App = () => {
  return (
    <HelmetProvider>
      <BrowserRouter>
        <ToastProvider>
          <TxProvider>
            <SpotProvider>
              <ErrorBoundary>
                <AppFrame />
                <TxProgressModal />
                <FillNotifier />
                <DesktopUpdateNotifier />
                <TestnetDisclaimer />
              </ErrorBoundary>
            </SpotProvider>
          </TxProvider>
        </ToastProvider>
      </BrowserRouter>
    </HelmetProvider>
  )
}

export default App
