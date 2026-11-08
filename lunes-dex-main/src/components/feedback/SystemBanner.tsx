/**
 * SystemBanner — sticky under the header (top: 64px).
 *
 * States, driven by RPC health (useNetworkStatus):
 *  - degraded     orange  "Network congestion…" + Status page
 *  - wrong        red     role=alert, not dismissible, "Switch to Lunes"
 *  - maintenance  purple
 *  - testnet      purple
 * Every state except `wrong` can be dismissed (per session, per state).
 *
 * The testnet notice is independent of RPC health: on any non-mainnet build
 * it is always shown (also on the landing, `placement="bottom"`), even while
 * a degraded/maintenance banner is up, and can only be dismissed for the
 * current browser session (sessionStorage) — never permanently.
 */
import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { AlertTriangle, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { fadeIn } from '../../styles/motion'
import { useNetworkStatus, NetworkStatus } from '../../hooks/useNetworkStatus'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { NETWORK } from '../../config/contracts'

type Conf = {
  bg: string
  border: string
  color: string
  title: string
  body: string
  action?: string
  canDismiss: boolean
  role: 'status' | 'alert'
}

const CONF: Record<Exclude<NetworkStatus, 'ok'>, Conf> = {
  degraded: {
    bg: 'rgba(254,146,63,0.1)',
    border: 'rgba(254,146,63,0.35)',
    color: '#FE923F',
    title: 'Network congestion.',
    body: 'Lunes blocks are slower than usual — transactions may take longer to confirm.',
    action: 'Status page',
    canDismiss: true,
    role: 'status'
  },
  wrong: {
    bg: 'rgba(255,40,76,0.12)',
    border: 'rgba(255,93,105,0.45)',
    color: '#FF807E',
    title: 'Wrong network.',
    body: 'The node this app is connected to is not the expected Lunes network. Do not sign transactions until this is fixed.',
    action: 'Reconnect',
    canDismiss: false,
    role: 'alert'
  },
  maintenance: {
    bg: 'rgba(108,56,255,0.12)',
    border: '#3C1CB7',
    color: '#CAAFFF',
    title: 'Scheduled maintenance.',
    body: 'Some services may be briefly unavailable. Swaps and pools stay available.',
    canDismiss: true,
    role: 'status'
  },
  testnet: {
    bg: 'rgba(108,56,255,0.12)',
    border: '#3C1CB7',
    color: '#CAAFFF',
    title: 'Lunes testnet — beta.',
    body: 'Test tokens have no real value, balances may be reset at any time. Nothing here is financial advice.',
    canDismiss: true,
    role: 'status'
  }
}

const Wrap = styled.div<{ $bottom?: boolean }>`
  position: ${p => (p.$bottom ? 'fixed' : 'sticky')};
  ${p => (p.$bottom ? 'bottom: 0; left: 0; right: 0;' : 'top: 64px;')}
  z-index: ${p => (p.$bottom ? 45 : 29)};
`

const Bar = styled.div<{ $c: Conf; $pad: string; $bottom?: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px ${p => p.$pad};
  background: ${p => p.$c.bg};
  border-bottom: 1px solid ${p => p.$c.border};
  color: ${p => p.$c.color};
  font-size: 13px;
  line-height: 1.4;
  animation: ${fadeIn} 200ms ease;
  backdrop-filter: blur(8px);
  strong {
    font-weight: 600;
  }
  .body {
    color: #d0d0d3;
  }
  button.act {
    height: 30px;
    padding: 0 12px;
    border-radius: 8px;
    border: 1px solid ${p => p.$c.border};
    background: transparent;
    color: ${p => p.$c.color};
    font-family: 'Inter', sans-serif;
    font-size: 12px;
    font-weight: 600;
  }
  a.act {
    color: ${p => p.$c.color};
    font-weight: 600;
    font-size: 12px;
    white-space: nowrap;
  }
  button.x {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: transparent;
    color: ${p => p.$c.color};
    display: flex;
    align-items: center;
    justify-content: center;
  }
`

const STATUS_URL = 'https://status.lunes.io'
const TESTNET_KEY = 'lunex-testnet-banner-dismissed'
const STATUS_KEY = 'lunex-banner-dismissed'

const readSession = (k: string): string | null => {
  try {
    return sessionStorage.getItem(k)
  } catch {
    return null
  }
}
const writeSession = (k: string, v: string) => {
  try {
    sessionStorage.setItem(k, v)
  } catch {
    /* noop */
  }
}

type Props = {
  /** `bottom` = fixed bar at the viewport bottom (landing, no app shell). */
  placement?: 'sticky' | 'bottom'
}

export const SystemBanner: React.FC<Props> = ({ placement = 'sticky' }) => {
  const { status, switchNetwork } = useNetworkStatus()
  const mobile = useIsMobile()
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [testnetHidden, setTestnetHidden] = useState(false)
  const isTestnet = NETWORK.name !== 'mainnet'
  const bottom = placement === 'bottom'

  useEffect(() => {
    setDismissed(readSession(STATUS_KEY))
    setTestnetHidden(readSession(TESTNET_KEY) === '1')
  }, [])

  const pad = mobile ? '16px' : '24px'
  // Status banner: anything but ok/testnet (testnet has its own stripe).
  const showStatus =
    status !== 'ok' && status !== 'testnet' && dismissed !== status
  const showTestnet = isTestnet && !testnetHidden && !(bottom && showStatus)

  const statusBar = showStatus
    ? (() => {
        const c = CONF[status as Exclude<NetworkStatus, 'ok'>]
        return (
          <Bar role={c.role} $c={c} $pad={pad} $bottom={bottom}>
            <AlertTriangle size={16} strokeWidth={2} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <strong>{c.title}</strong> <span className="body">{c.body}</span>
            </span>
            {c.action && (
              <button
                className="act"
                onClick={() =>
                  status === 'wrong'
                    ? switchNetwork()
                    : window.open(STATUS_URL, '_blank', 'noopener')
                }
              >
                {c.action}
              </button>
            )}
            {c.canDismiss && (
              <button
                className="x"
                aria-label="Dismiss"
                onClick={() => {
                  setDismissed(status)
                  writeSession(STATUS_KEY, status)
                }}
              >
                <X size={14} strokeWidth={2} />
              </button>
            )}
          </Bar>
        )
      })()
    : null

  const c = CONF.testnet
  const testnetBar = showTestnet ? (
    <Bar
      role="status"
      $c={c}
      $pad={pad}
      $bottom={bottom}
      data-testid="testnet-banner"
    >
      <AlertTriangle size={16} strokeWidth={2} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <strong>{c.title}</strong> <span className="body">{c.body}</span>
      </span>
      <Link className="act" to="/faucet">
        Get test tokens
      </Link>
      <button
        className="x"
        aria-label="Hide testnet notice for this session"
        onClick={() => {
          setTestnetHidden(true)
          writeSession(TESTNET_KEY, '1')
        }}
      >
        <X size={14} strokeWidth={2} />
      </button>
    </Bar>
  ) : null

  if (!statusBar && !testnetBar) return null
  return (
    <Wrap $bottom={bottom}>
      {statusBar}
      {testnetBar}
    </Wrap>
  )
}

export default SystemBanner
