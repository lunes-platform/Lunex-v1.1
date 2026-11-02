import { useCallback, useState } from 'react'
import { useSDK } from '../../context/SDKContext'
import { useTx } from '../../context/TxContext'
import socialApi, {
  buildCopytradeDepositMessage,
  buildCopytradeWithdrawMessage,
  buildWalletActionMessage,
  createSignedActionMetadata,
  CopytradeActivityItem,
  CopytradePosition
} from '../../services/socialService'

const fmtAmt = (v: number) =>
  (Number.isFinite(v) ? v : 0).toLocaleString('en-US', {
    maximumFractionDigits: 2
  })

/**
 * Follower positions + activity. Both endpoints require a signed read, so
 * loading is explicit (triggered by the page) instead of on every render.
 */
export const useCopyPositions = () => {
  const { signMessage } = useSDK()
  const [positions, setPositions] = useState<CopytradePosition[]>([])
  const [activity, setActivity] = useState<CopytradeActivityItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(
    async (address: string, opts: { withActivity?: boolean } = {}) => {
      setLoading(true)
      setError('')
      try {
        const sp = createSignedActionMetadata()
        const spSig = await signMessage(
          buildWalletActionMessage({
            action: 'copytrade.positions',
            address,
            nonce: sp.nonce,
            timestamp: sp.timestamp
          })
        )
        const nextPositions = await socialApi.getPositions(address, {
          address,
          nonce: sp.nonce,
          timestamp: sp.timestamp,
          signature: spSig
        })
        setPositions(nextPositions)

        if (opts.withActivity) {
          const sa = createSignedActionMetadata()
          const saSig = await signMessage(
            buildWalletActionMessage({
              action: 'copytrade.activity',
              address,
              nonce: sa.nonce,
              timestamp: sa.timestamp,
              fields: { limit: 20 }
            })
          )
          const nextActivity = await socialApi.getActivity(
            address,
            {
              address,
              nonce: sa.nonce,
              timestamp: sa.timestamp,
              signature: saSig
            },
            20
          )
          setActivity(nextActivity)
        }
        setLoadedFor(address)
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : 'Could not load your positions'
        )
      } finally {
        setLoading(false)
      }
    },
    [signMessage]
  )

  const reset = useCallback(() => {
    setPositions([])
    setActivity([])
    setLoadedFor(null)
    setError('')
  }, [])

  return { positions, activity, loading, loadedFor, error, load, reset }
}

/** Deposit into a leader's copy vault through the shared tx flow. */
export const useCopyDeposit = () => {
  const { walletAddress, signMessage } = useSDK()
  const tx = useTx()

  return useCallback(
    (input: {
      leaderId: string
      leaderName: string
      token: string
      amount: string
      onSuccess?: () => void
    }) => {
      if (!walletAddress) return
      const follower = walletAddress
      let signature = ''
      let auth = createSignedActionMetadata()
      const amountLabel = `${fmtAmt(Number(input.amount))} ${input.token}`
      tx.run({
        type: 'social',
        title: 'Starting copy',
        summary: `${input.leaderName} · ${amountLabel}`,
        actTitle: `Copy ${input.leaderName} · ${amountLabel}`,
        successTitle: 'Copying started',
        // No allowance step: vault deposits are authorised by the signed
        // wallet action below (approval steps only show when one is missing).
        steps: [
          {
            label: 'Sign deposit in your wallet',
            wallet: true,
            run: async () => {
              auth = createSignedActionMetadata()
              signature = await signMessage(
                buildCopytradeDepositMessage({
                  leaderId: input.leaderId,
                  followerAddress: follower,
                  token: input.token,
                  amount: input.amount,
                  nonce: auth.nonce,
                  timestamp: auth.timestamp
                })
              )
              return true
            }
          },
          {
            label: 'Waiting for block confirmation',
            run: async () => {
              const res = await socialApi.depositToVault(input.leaderId, {
                followerAddress: follower,
                token: input.token,
                amount: input.amount,
                nonce: auth.nonce,
                timestamp: auth.timestamp,
                signature
              })
              return res.txHash || true
            }
          }
        ],
        onSuccess: input.onSuccess
      })
    },
    [walletAddress, signMessage, tx]
  )
}

/** Withdraw shares from a copy vault through the shared tx flow. */
export const useCopyWithdraw = () => {
  const { signMessage } = useSDK()
  const tx = useTx()

  return useCallback(
    (
      position: CopytradePosition,
      shares: string,
      onSuccess?: () => void,
      opts: { stop?: boolean } = {}
    ) => {
      let signature = ''
      let auth = createSignedActionMetadata()
      const name = position.vault.leaderName || position.vault.name
      const pct =
        position.shareBalance > 0 ? Number(shares) / position.shareBalance : 1
      const valueLabel = `${fmtAmt(position.currentValue * Math.min(1, pct))} ${
        position.vault.collateralToken
      }`
      tx.run({
        type: 'social',
        title: opts.stop ? 'Stopping copy' : 'Withdrawing',
        summary: `${name} Vault · ≈${valueLabel}`,
        actTitle: `${opts.stop ? 'Stop copying' : 'Withdraw'} ${name} Vault`,
        successTitle: opts.stop ? 'Stopped copying' : 'Withdrawn',
        steps: [
          {
            label: 'Sign withdrawal in your wallet',
            wallet: true,
            run: async () => {
              auth = createSignedActionMetadata()
              signature = await signMessage(
                buildCopytradeWithdrawMessage({
                  leaderId: position.vault.leaderId,
                  followerAddress: position.followerAddress,
                  shares,
                  nonce: auth.nonce,
                  timestamp: auth.timestamp
                })
              )
              return true
            }
          },
          {
            label: 'Waiting for block confirmation',
            run: async () => {
              const res = await socialApi.withdrawFromVault(
                position.vault.leaderId,
                {
                  followerAddress: position.followerAddress,
                  shares,
                  nonce: auth.nonce,
                  timestamp: auth.timestamp,
                  signature
                }
              )
              return res.txHash || true
            }
          }
        ],
        onSuccess
      })
    },
    [signMessage, tx]
  )
}
