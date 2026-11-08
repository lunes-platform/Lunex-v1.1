/**
 * ToastProvider + notification center state.
 *
 * Toasts
 * - Tones: success, error, warning, info, pending (each with its own icon).
 * - Durations: 5s info/success, 7s warning, 8s error; pending is sticky.
 * - Timer bar shows remaining time; pauses on hover and focus.
 * - Exit: collapse animation. Keyed by id (re-using an id updates in place).
 * - Optional action: "View in activity", "Try again", "Show details"…
 * - Position: bottom-right 24px (desktop); full width at bottom 84px (mobile).
 * - a11y: error/warning use role="alert"; others role="status".
 *
 * Notifications
 * - Every toast is logged (unless `silent`); `logOnly` logs as read without
 *   showing a toast (used when the tx modal is already visible).
 * - `ring` shakes the bell — only for async events (background tx finished,
 *   limit order filled, rewards ready, proposal ending).
 * - Last 30 items persisted in localStorage.
 *
 * Backwards compatible: `useToast().success(msg)` etc. still work.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useNavigate } from 'react-router-dom'
import styled, { css } from 'styled-components'
import { Check, X, AlertTriangle, Info } from 'lucide-react'
import {
  toastIn,
  toastUp,
  toastCollapse,
  timerBar,
  pop,
  drawStroke,
  spin
} from '../../styles/motion'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { EASE_IN, EASE_OUT } from '../ui/kit'

export type ToastTone = 'success' | 'error' | 'warning' | 'info' | 'pending'
export type NotifCat = 'tx' | 'market' | 'gov' | 'system'

export type ToastAction = {
  label: string
  /** Route to navigate to. */
  route?: string
  onClick?: () => void
}

export type ToastOptions = {
  id?: string
  action?: ToastAction
  sticky?: boolean
  cat?: NotifCat
  /** Shake the bell (async events only). */
  ring?: boolean
  /** Only log to the notification center (as read), no toast. */
  logOnly?: boolean
  /** Do not log to the notification center. */
  silent?: boolean
  /** Progress for pending toasts, 0–100. */
  pct?: number
  /** Route opened when clicking the notification. */
  route?: string
}

type ToastItem = {
  id: string
  tone: ToastTone
  title: string
  body?: string
  action?: ToastAction
  dur: number
  paused: boolean
  leaving: boolean
  pct?: number
}

export type NotificationItem = {
  id: string
  tone: ToastTone
  title: string
  body?: string
  cat: NotifCat
  ts: number
  read: boolean
  route?: string
}

type ToastApi = {
  toast: (
    tone: ToastTone,
    title: string,
    body?: string,
    opts?: ToastOptions
  ) => string
  dismiss: (id: string) => void
  success: (message: string, body?: string) => void
  error: (message: string, body?: string) => void
  info: (message: string, body?: string) => void
  warning: (message: string, body?: string) => void
}

type NotifApi = {
  items: NotificationItem[]
  unread: number
  bellRing: number
  markAllRead: () => void
  markRead: (id: string) => void
  clear: () => void
}

const ToastContext = createContext<ToastApi | null>(null)
const NotifContext = createContext<NotifApi | null>(null)

export const useToast = (): ToastApi => {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

export const useNotifications = (): NotifApi => {
  const ctx = useContext(NotifContext)
  if (!ctx)
    throw new Error('useNotifications must be used within ToastProvider')
  return ctx
}

const STORAGE_KEY = 'lunex-notifications'
const DURATION: Record<ToastTone, number> = {
  info: 5000,
  success: 5000,
  warning: 7000,
  error: 8000,
  pending: 0
}

export const TONES: Record<ToastTone, [string, string, string]> = {
  success: ['#26D07C', 'rgba(38,208,124,0.16)', 'rgba(38,208,124,0.35)'],
  error: ['#FF5D69', 'rgba(255,40,76,0.16)', 'rgba(255,93,105,0.4)'],
  info: ['#AD87FF', 'rgba(108,56,255,0.16)', '#47474A'],
  warning: ['#FE923F', 'rgba(254,146,63,0.16)', 'rgba(254,146,63,0.35)'],
  pending: ['#CAAFFF', 'rgba(108,56,255,0.16)', '#3C1CB7']
}

const loadNotifs = (): NotificationItem[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.slice(0, 30) : []
  } catch {
    return []
  }
}

// ─── Styles ──────────────────────────────────────────────────────

const Stack = styled.div<{ $mobile: boolean }>`
  position: fixed;
  z-index: 80;
  right: ${p => (p.$mobile ? 12 : 24)}px;
  left: ${p => (p.$mobile ? '12px' : 'auto')};
  bottom: ${p => (p.$mobile ? 84 : 24)}px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-end;
  pointer-events: none;
`

const Card = styled.div<{
  $border: string
  $leaving: boolean
  $mobile: boolean
}>`
  pointer-events: auto;
  position: relative;
  overflow: hidden;
  width: 100%;
  max-width: ${p => (p.$mobile ? 'none' : '360px')};
  max-height: 220px;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 14px 14px 16px;
  border-radius: 14px;
  background: #232323;
  border: 1px solid ${p => p.$border};
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.55);
  animation: ${p =>
    p.$leaving
      ? css`
          ${toastCollapse} 260ms ${EASE_IN} forwards
        `
      : css`
          ${p.$mobile ? toastUp : toastIn} 300ms ${EASE_OUT}
        `};
`

const IconWrap = styled.div<{ $fg: string; $bg: string }>`
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 50%;
  background: ${p => p.$bg};
  color: ${p => p.$fg};
  display: flex;
  align-items: center;
  justify-content: center;
  animation: ${pop} 300ms ease both;
  .draw path {
    stroke-dasharray: 24;
    animation: ${drawStroke} 300ms ease 120ms both;
  }
`

const PendingSpin = styled.span`
  width: 16px;
  height: 16px;
  border: 2px solid rgba(202, 175, 255, 0.3);
  border-top-color: #caafff;
  border-radius: 50%;
  animation: ${spin} 0.7s linear infinite;
`

const Body = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-top: 1px;
  strong {
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 600;
    font-size: 14px;
  }
  span {
    font-size: 13px;
    color: #b6b6b6;
    line-height: 1.45;
  }
`

const ActionBtn = styled.button<{ $color: string }>`
  align-self: flex-start;
  margin-top: 4px;
  padding: 0;
  border: none;
  background: none;
  color: ${p => p.$color};
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 600;
`

const Dismiss = styled.button`
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #8a8a8e;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  &:hover {
    color: #fff;
    background: #2a2a2c;
  }
`

const Bar = styled.div<{ $color: string; $dur: number; $paused: boolean }>`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: ${p => p.$color};
  opacity: 0.85;
  transform-origin: left;
  animation: ${timerBar} ${p => p.$dur}ms linear forwards;
  animation-play-state: ${p => (p.$paused ? 'paused' : 'running')};
`

const PendingBar = styled.div<{ $pct: number }>`
  position: absolute;
  left: 0;
  bottom: 0;
  height: 3px;
  width: ${p => p.$pct}%;
  background: #6c38ff;
  transition: width 500ms ease;
`

const ToneIcon: React.FC<{ tone: ToastTone }> = ({ tone }) => {
  if (tone === 'pending') return <PendingSpin data-motion="pulse" />
  if (tone === 'success')
    return <Check className="draw" size={16} strokeWidth={2.25} />
  if (tone === 'error') return <X size={16} strokeWidth={2.25} />
  if (tone === 'warning') return <AlertTriangle size={16} strokeWidth={2.25} />
  return <Info size={16} strokeWidth={2.25} />
}

// ─── Provider ────────────────────────────────────────────────────

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  const navigate = useNavigate()
  const mobile = useIsMobile()
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [notifs, setNotifs] = useState<NotificationItem[]>(loadNotifs)
  const [bellRing, setBellRing] = useState(0)
  const timers = useRef<
    Record<
      string,
      { h?: ReturnType<typeof setTimeout>; left: number; at: number }
    >
  >({})

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notifs.slice(0, 30)))
    } catch {
      /* storage unavailable */
    }
  }, [notifs])

  const remove = useCallback((id: string) => {
    const t = timers.current[id]
    if (t?.h) clearTimeout(t.h)
    delete timers.current[id]
    setToasts(prev =>
      prev.map(x => (x.id === id ? { ...x, leaving: true } : x))
    )
    setTimeout(
      () => setToasts(prev => prev.filter(x => x.id !== id || !x.leaving)),
      260
    )
  }, [])

  const schedule = useCallback(
    (id: string, ms: number) => {
      const t = timers.current[id] || { left: ms, at: Date.now() }
      if (t.h) clearTimeout(t.h)
      t.left = ms
      t.at = Date.now()
      t.h = setTimeout(() => remove(id), ms)
      timers.current[id] = t
    },
    [remove]
  )

  const pause = useCallback((id: string) => {
    const t = timers.current[id]
    if (!t?.h) return
    clearTimeout(t.h)
    t.h = undefined
    t.left = Math.max(400, t.left - (Date.now() - t.at))
    setToasts(prev => prev.map(x => (x.id === id ? { ...x, paused: true } : x)))
  }, [])

  const resume = useCallback(
    (id: string) => {
      const t = timers.current[id]
      if (!t || t.h) return
      schedule(id, t.left)
      setToasts(prev =>
        prev.map(x => (x.id === id ? { ...x, paused: false } : x))
      )
    },
    [schedule]
  )

  const toast = useCallback<ToastApi['toast']>(
    (tone, title, body, opts = {}) => {
      const id =
        opts.id || `t${Date.now()}${Math.random().toString(36).slice(2, 6)}`
      const route = opts.route ?? opts.action?.route

      if (!opts.silent && tone !== 'pending') {
        setNotifs(prev =>
          [
            {
              id: `${id}-${Date.now()}`,
              tone,
              title,
              body,
              cat: opts.cat ?? 'system',
              ts: Date.now(),
              read: !!opts.logOnly,
              route
            },
            ...prev
          ].slice(0, 30)
        )
        if (opts.ring && !opts.logOnly) setBellRing(n => n + 1)
      }

      if (opts.logOnly) {
        // the same id may be showing as a pending toast: retire it
        if (opts.id) remove(opts.id)
        return id
      }

      const sticky = opts.sticky || tone === 'pending'
      const dur = sticky ? 0 : DURATION[tone]
      setToasts(prev => {
        const exists = prev.some(x => x.id === id && !x.leaving)
        const item: ToastItem = {
          id,
          tone,
          title,
          body,
          action: opts.action,
          dur,
          paused: false,
          leaving: false,
          pct: opts.pct
        }
        if (exists) return prev.map(x => (x.id === id ? item : x))
        return [...prev.filter(x => x.id !== id), item].slice(-4)
      })
      if (dur) schedule(id, dur)
      else {
        const t = timers.current[id]
        if (t?.h) clearTimeout(t.h)
        delete timers.current[id]
      }
      return id
    },
    [remove, schedule]
  )

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      dismiss: remove,
      success: (m, b) => void toast('success', m, b),
      error: (m, b) => void toast('error', m, b),
      info: (m, b) => void toast('info', m, b, { silent: true }),
      warning: (m, b) => void toast('warning', m, b)
    }),
    [toast, remove]
  )

  const notifApi = useMemo<NotifApi>(
    () => ({
      items: notifs,
      unread: notifs.filter(n => !n.read).length,
      bellRing,
      markAllRead: () =>
        setNotifs(prev => prev.map(n => (n.read ? n : { ...n, read: true }))),
      markRead: id =>
        setNotifs(prev =>
          prev.map(n => (n.id === id ? { ...n, read: true } : n))
        ),
      clear: () => setNotifs([])
    }),
    [notifs, bellRing]
  )

  return (
    <ToastContext.Provider value={api}>
      <NotifContext.Provider value={notifApi}>
        {children}
        <Stack role="region" aria-label="Notifications" $mobile={mobile}>
          {toasts.map(t => {
            const c = TONES[t.tone]
            return (
              <Card
                key={t.id}
                role={
                  t.tone === 'error' || t.tone === 'warning'
                    ? 'alert'
                    : 'status'
                }
                $border={c[2]}
                $leaving={t.leaving}
                $mobile={mobile}
                onMouseEnter={() => pause(t.id)}
                onMouseLeave={() => resume(t.id)}
                onFocus={() => pause(t.id)}
                onBlur={() => resume(t.id)}
              >
                <IconWrap $fg={c[0]} $bg={c[1]}>
                  <ToneIcon tone={t.tone} />
                </IconWrap>
                <Body>
                  <strong>{t.title}</strong>
                  {t.body && <span>{t.body}</span>}
                  {t.action && (
                    <ActionBtn
                      $color={c[0]}
                      onClick={() => {
                        const a = t.action as ToastAction
                        remove(t.id)
                        if (a.onClick) a.onClick()
                        else if (a.route) navigate(a.route)
                      }}
                    >
                      {t.action.label} →
                    </ActionBtn>
                  )}
                </Body>
                <Dismiss aria-label="Dismiss" onClick={() => remove(t.id)}>
                  <X size={14} strokeWidth={2} />
                </Dismiss>
                {t.dur > 0 && (
                  <Bar $color={c[0]} $dur={t.dur} $paused={t.paused} />
                )}
                {t.tone === 'pending' && <PendingBar $pct={t.pct ?? 0} />}
              </Card>
            )
          })}
        </Stack>
      </NotifContext.Provider>
    </ToastContext.Provider>
  )
}

export default ToastProvider
