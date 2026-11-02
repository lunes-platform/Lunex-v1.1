/**
 * TxContext — one transaction flow for the whole app.
 *
 * Replaces waitingConfirmation / transactionSubmitted / modalError, the inline
 * TxStatusBanner and every alert(). Wraps real useSDK() calls:
 *
 *   const tx = useTx()
 *   tx.run({
 *     type: 'swap',
 *     title: 'Swapping',
 *     summary: '100 WLUNES → 1.42 LUSDT',
 *     actTitle: 'Swap 100 WLUNES → 1.42 LUSDT',
 *     successTitle: 'Swap confirmed',
 *     steps: [
 *       { label: 'Approve LUSDT spending', wallet: true, run: () => approve() },
 *       { label: 'Sign swap in your wallet', wallet: true,
 *         run: ({ advance }) => sdk.executeSwap(p).then(ok => { advance(); return ok }) },
 *       { label: 'Waiting for block confirmation' }
 *     ]
 *   })
 *
 * A step's `run` may resolve `false` (failure), a string (tx hash) or anything
 * else (success). Steps without `run` are visual and complete together with
 * the previous `run`, or earlier when it calls `advance()`.
 * Errors whose message looks like a wallet cancellation become "rejected".
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
import { useToast } from '../components/feedback/ToastProvider'
import { parseBlockchainError, useSDK } from './SDKContext'

export type TxType =
  'swap' | 'liquidity' | 'staking' | 'spot' | 'governance' | 'social' | 'other'

export type TxStepCtx = { advance: () => void }

export type TxStep = {
  label: string
  /** The step waits for the wallet → shows "Approve the request in Lunes Wallet". */
  wallet?: boolean
  run?: (ctx: TxStepCtx) => Promise<unknown> | unknown
}

export type TxConfig = {
  type: TxType
  title: string
  summary: string
  actTitle: string
  successTitle: string
  steps: TxStep[]
  onSuccess?: (hash?: string) => void
  /** Copy used when a step resolves `false` without an error message. */
  errorText?: string
}

export type TxStatus = 'active' | 'success' | 'error' | 'rejected'

export type TxState = {
  id: number
  cfg: TxConfig
  current: number
  status: TxStatus
  slow: boolean
  hash?: string
  error?: string
  hidden: boolean
}

export type ActivityStatus = 'pending' | 'confirmed' | 'failed' | 'rejected'

export type ActivityItem = {
  id: number
  type: TxType
  title: string
  ts: number
  status: ActivityStatus
  hash?: string
}

type TxApi = {
  tx: TxState | null
  activity: ActivityItem[]
  pendingCount: number
  run: (cfg: TxConfig) => void
  retry: () => void
  background: () => void
  show: () => void
  close: () => void
}

const TxContext = createContext<TxApi | null>(null)

export const useTx = (): TxApi => {
  const ctx = useContext(TxContext)
  if (!ctx) throw new Error('useTx must be used within TxProvider')
  return ctx
}

const ACTIVITY_KEY = 'lunex-activity'
const SLOW_AFTER_MS = 2400
const REJECT_RE = /cancel|reject|denied|declined|user abort/i

const loadActivity = (): ActivityItem[] => {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY)
    const arr = raw ? JSON.parse(raw) : []
    // a pending item from a previous session can't be tracked any more
    return Array.isArray(arr)
      ? arr
          .slice(0, 50)
          .map((a: ActivityItem) =>
            a.status === 'pending' ? { ...a, status: 'failed' } : a
          )
      : []
  } catch {
    return []
  }
}

const looksLikeHash = (v: unknown): v is string =>
  typeof v === 'string' && /^0x[0-9a-fA-F]{16,}$/.test(v)

export const shortHash = (h?: string) =>
  h ? `${h.slice(0, 10)}…${h.slice(-8)}` : ''

export const TxProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  const { toast } = useToast()
  const sdk = useSDK()
  const sdkRef = useRef(sdk)
  sdkRef.current = sdk
  const [tx, setTx] = useState<TxState | null>(null)
  const [activity, setActivity] = useState<ActivityItem[]>(loadActivity)
  const txRef = useRef<TxState | null>(null)
  txRef.current = tx
  const lastCfg = useRef<TxConfig | null>(null)
  const runId = useRef(0)

  useEffect(() => {
    try {
      localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity.slice(0, 50)))
    } catch {
      /* storage unavailable */
    }
  }, [activity])

  const pendingToast = useCallback(
    (t: TxState) => {
      const n = t.cfg.steps.length
      const cur = Math.min(t.current, n - 1)
      toast(
        'pending',
        `${t.cfg.title}…`,
        `${t.cfg.steps[cur].label} · step ${cur + 1} of ${n}`,
        {
          id: 'tx',
          sticky: true,
          cat: 'tx',
          pct: ((cur + 0.5) / n) * 100,
          action: {
            label: 'Show details',
            onClick: () => setTx(s => (s ? { ...s, hidden: false } : s))
          }
        }
      )
    },
    [toast]
  )

  const run = useCallback(
    (cfg: TxConfig) => {
      const id = ++runId.current
      lastCfg.current = cfg
      const steps = cfg.steps
      const alive = () => runId.current === id

      setTx({
        id,
        cfg,
        current: 0,
        status: 'active',
        slow: false,
        hidden: false
      })
      setActivity(prev =>
        [
          {
            id,
            type: cfg.type,
            title: cfg.actTitle,
            ts: Date.now(),
            status: 'pending' as const
          },
          ...prev
        ].slice(0, 50)
      )

      const setAct = (status: ActivityStatus, hash?: string) =>
        setActivity(prev =>
          prev.map(a =>
            a.id === id ? { ...a, status, hash: hash ?? a.hash } : a
          )
        )

      const update = (patch: Partial<TxState>) => {
        if (!alive()) return
        setTx(s => {
          if (!s || s.id !== id) return s
          const next = { ...s, ...patch }
          if (next.hidden && next.status === 'active') pendingToast(next)
          return next
        })
      }

      const finish = (
        tone: 'success' | 'error' | 'warning',
        title: string,
        body: string,
        action: { label: string; route?: string; onClick?: () => void },
        forceVisible: boolean
      ) => {
        const visible = forceVisible || !txRef.current?.hidden
        toast(tone, title, body, {
          id: 'tx',
          cat: 'tx',
          action,
          route: '/activity',
          logOnly: visible,
          ring: !visible
        })
      }

      const retryAction = {
        label: 'Try again',
        onClick: () => lastCfg.current && runRef.current(lastCfg.current)
      }

      ;(async () => {
        let hash: string | undefined
        let i = 0
        let slowTimer: ReturnType<typeof setTimeout> | undefined
        try {
          while (i < steps.length) {
            if (!alive()) return
            const step = steps[i]
            update({ current: i })
            if (!step.run) {
              i++
              continue
            }
            // the last runnable step covers the confirmation wait → slow hint
            const isLastRun = !steps.slice(i + 1).some(s => s.run)
            if (isLastRun) {
              slowTimer = setTimeout(
                () => update({ slow: true }),
                SLOW_AFTER_MS
              )
            }
            let advanced = false
            const res = await step.run({
              advance: () => {
                if (advanced) return
                advanced = true
                if (i + 1 < steps.length) update({ current: i + 1 })
              }
            })
            if (slowTimer) clearTimeout(slowTimer)
            if (!alive()) return
            if (res === false) {
              throw new Error(
                sdkRef.current.getLastError() ||
                  cfg.errorText ||
                  'The transaction did not complete.'
              )
            }
            if (looksLikeHash(res)) hash = res
            // skip visual-only steps covered by this run
            let j = i + 1
            while (j < steps.length && !steps[j].run) j++
            i = j
          }
          if (!alive()) return
          cfg.onSuccess?.(hash)
          update({
            status: 'success',
            current: steps.length,
            slow: false,
            hash
          })
          setAct('confirmed', hash)
          finish(
            'success',
            cfg.successTitle,
            cfg.actTitle,
            { label: 'View in activity', route: '/activity' },
            false
          )
        } catch (err: unknown) {
          if (slowTimer) clearTimeout(slowTimer)
          if (!alive()) return
          const raw = err instanceof Error ? err.message : String(err)
          if (REJECT_RE.test(raw)) {
            update({
              status: 'rejected',
              hidden: false,
              slow: false,
              error: raw
            })
            setAct('rejected')
            finish(
              'warning',
              'Request rejected',
              `${cfg.actTitle} — nothing was sent.`,
              retryAction,
              true
            )
          } else {
            const msg = parseBlockchainError(err)
            update({ status: 'error', hidden: false, slow: false, error: msg })
            setAct('failed')
            finish(
              'error',
              'Transaction failed',
              `${cfg.actTitle} — ${msg}`,
              retryAction,
              true
            )
          }
        }
      })()
    },
    [pendingToast, toast]
  )

  const runRef = useRef(run)
  runRef.current = run

  const api = useMemo<TxApi>(
    () => ({
      tx,
      activity,
      pendingCount: activity.filter(a => a.status === 'pending').length,
      run,
      retry: () => lastCfg.current && run(lastCfg.current),
      background: () =>
        setTx(s => {
          if (!s) return s
          const next = { ...s, hidden: true }
          if (s.status === 'active') pendingToast(next)
          return s.status === 'active' ? next : null
        }),
      show: () => setTx(s => (s ? { ...s, hidden: false } : s)),
      close: () =>
        setTx(s => (s && s.status === 'active' ? { ...s, hidden: true } : null))
    }),
    [tx, activity, run, pendingToast]
  )

  return <TxContext.Provider value={api}>{children}</TxContext.Provider>
}

export default TxProvider
