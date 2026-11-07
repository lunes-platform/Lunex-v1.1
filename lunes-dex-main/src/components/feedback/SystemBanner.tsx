/**
 * SystemBanner — sticky under the header (top: 64px).
 *
 * States, driven by RPC health (useNetworkStatus):
 *  - degraded     orange  "Network congestion…" + Status page
 *  - wrong        red     role=alert, not dismissible, "Switch to Lunes"
 *  - maintenance  purple
 *  - testnet      purple
 * Every state except `wrong` can be dismissed (per session, per state).
 */
import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { AlertTriangle, X } from 'lucide-react'
import { fadeIn } from '../../styles/motion'
import { useNetworkStatus, NetworkStatus } from '../../hooks/useNetworkStatus'
import { useIsMobile } from '../../hooks/useMediaQuery'

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
    body: 'Your wallet is not on the Lunes network. Switch to Lunes to trade.',
    action: 'Switch to Lunes',
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
    title: 'Lunes testnet.',
    body: 'Tokens on this network have no real value.',
    canDismiss: true,
    role: 'status'
  }
}

const Bar = styled.div<{ $c: Conf; $pad: string }>`
  position: sticky;
  top: 64px;
  z-index: 29;
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

export const SystemBanner: React.FC = () => {
  const { status, switchNetwork } = useNetworkStatus()
  const mobile = useIsMobile()
  const [dismissed, setDismissed] = useState<string | null>(null)

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem('lunex-banner-dismissed'))
    } catch {
      /* noop */
    }
  }, [])

  if (status === 'ok' || dismissed === status) return null
  const c = CONF[status]

  const dismiss = () => {
    setDismissed(status)
    try {
      sessionStorage.setItem('lunex-banner-dismissed', status)
    } catch {
      /* noop */
    }
  }

  return (
    <Bar role={c.role} $c={c} $pad={mobile ? '16px' : '24px'}>
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
        <button className="x" aria-label="Dismiss" onClick={dismiss}>
          <X size={14} strokeWidth={2} />
        </button>
      )}
    </Bar>
  )
}

export default SystemBanner
