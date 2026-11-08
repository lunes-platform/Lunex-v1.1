import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { C, grotesk } from 'components/ui/kit'
import {
  NotifCat,
  ToastTone,
  useNotifications
} from 'components/feedback/ToastProvider'
import { Popover } from '../styles'

const TONE_DOT: Record<ToastTone, string> = {
  success: '#26D07C',
  error: '#FF5D69',
  info: '#AD87FF',
  warning: '#FE923F',
  pending: '#CAAFFF'
}

type Filter = 'all' | NotifCat

const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['tx', 'Transactions'],
  ['market', 'Market'],
  ['gov', 'Governance']
]

const relTime = (ts: number, now: number) => {
  const d = (now - ts) / 1000
  if (d < 60) return 'Just now'
  if (d < 3600) return `${Math.floor(d / 60)} min ago`
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`
  return `${Math.floor(d / 86400)} d ago`
}

const Head = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px 10px;
  position: sticky;
  top: 0;
  background: ${C.surface};
  z-index: 1;
  h2 {
    ${grotesk};
    font-weight: 600;
    font-size: 16px;
  }
`

const MarkAll = styled.button`
  border: none;
  background: none;
  color: ${C.primaryText};
  font-size: 12px;
  font-weight: 600;
  padding: 0;
  &:hover {
    color: ${C.primaryText2};
  }
  &:disabled {
    color: ${C.muted};
    cursor: default;
  }
`

const Filters = styled.div`
  display: flex;
  gap: 4px;
  padding: 0 16px 10px;
  flex-wrap: wrap;
`

const FilterPill = styled.button<{ $active: boolean }>`
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid ${p => (p.$active ? C.primary : C.borderStrong)};
  background: ${p => (p.$active ? 'rgba(108,56,255,0.16)' : 'transparent')};
  color: ${p => (p.$active ? C.primaryText2 : C.secondary)};
  font-size: 12px;
  font-weight: 600;
`

const EmptyRow = styled.div`
  padding: 28px 16px;
  text-align: center;
  font-size: 13px;
  color: ${C.muted};
`

const Item = styled.button<{ $unread: boolean }>`
  display: flex;
  gap: 12px;
  align-items: flex-start;
  width: 100%;
  padding: 12px 16px;
  border: none;
  border-top: 1px solid ${C.border};
  background: ${p => (p.$unread ? 'rgba(108,56,255,0.06)' : 'transparent')};
  color: ${C.text};
  text-align: left;
  transition: background-color 150ms ease;
  &:hover,
  &:focus-visible {
    background: ${C.field};
  }
`

const Dot = styled.span<{ $c: string; $size?: number }>`
  width: ${p => p.$size ?? 8}px;
  height: ${p => p.$size ?? 8}px;
  margin-top: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: ${p => p.$c};
`

const Text = styled.span`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  b {
    font-weight: 600;
    font-size: 13px;
  }
  span {
    font-size: 12px;
    color: ${C.secondary};
    line-height: 1.4;
  }
  time {
    font-size: 11px;
    color: ${C.muted};
  }
`

const NotificationPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { items, unread, markAllRead, markRead } = useNotifications()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')
  const [now, setNow] = useState(() => Date.now())

  // Refresh relative times while the panel is open.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  const rows = items.filter(n => filter === 'all' || n.cat === filter)

  return (
    <Popover
      $width={360}
      $mobileFixed
      role="dialog"
      aria-label="Notifications"
      style={{ borderRadius: 16 }}
    >
      <Head>
        <h2>Notifications</h2>
        <MarkAll onClick={markAllRead} disabled={unread === 0}>
          Mark all as read
        </MarkAll>
      </Head>
      <Filters role="tablist" aria-label="Filter notifications">
        {FILTERS.map(([k, l]) => (
          <FilterPill
            key={k}
            role="tab"
            aria-selected={filter === k}
            $active={filter === k}
            onClick={() => setFilter(k)}
          >
            {l}
          </FilterPill>
        ))}
      </Filters>
      {rows.length === 0 && <EmptyRow>You are all caught up.</EmptyRow>}
      {rows.map(n => (
        <Item
          key={n.id}
          $unread={!n.read}
          onClick={() => {
            markRead(n.id)
            if (n.route) {
              navigate(n.route)
              onClose()
            }
          }}
        >
          <Dot $c={TONE_DOT[n.tone] ?? TONE_DOT.info} aria-hidden />
          <Text>
            <b>{n.title}</b>
            {n.body && <span>{n.body}</span>}
            <time dateTime={new Date(n.ts).toISOString()}>
              {relTime(n.ts, now)}
            </time>
          </Text>
          {!n.read && (
            <Dot $c={C.primary} $size={7} aria-label="Unread" role="img" />
          )}
        </Item>
      ))}
    </Popover>
  )
}

export default NotificationPanel
