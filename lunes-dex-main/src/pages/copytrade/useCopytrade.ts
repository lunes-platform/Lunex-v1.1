import { useCallback, useState } from 'react'
import { useSDK } from '../../context/SDKContext'
import { useTx } from '../../context/TxContext'
import socialApi, {
  CopytradeActivityItem,
  CopytradePosition
} from '../../services/socialService'
import {
  ReadSessionRequiredError,
  requireReadAuth
} from '../../services/sessionService'
import contractService from '../../services/contractService'
import { getWalletAccount } from '../../wallet/activeWallet'
import { NETWORK } from '../../config/contracts'
import {
  buildCopyDepositSteps,
  buildCopyWithdrawSteps,
  type CopyVaultChain
} from './copytradeFlow'

/** On-chain CopyVault calls signed by the connected follower wallet. */
const vaultChain: CopyVaultChain = {
  async deposit(vaultAddress, amountPlancks, follower) {
    const account = await connectedAccount(follower)
    return contractService.depositToCopyVault(
      vaultAddress,
      amountPlancks,
      account
    )
  },
  async withdraw(vaultAddress, sharesPlancks, follower) {
    const account = await connectedAccount(follower)
    return contractService.withdrawFromCopyVault(
      vaultAddress,
      sharesPlancks,
      account
    )
  },
  async requestWithdrawal(vaultAddress, sharesPlancks, follower) {
    const account = await connectedAccount(follower)
    return contractService.requestCopyVaultWithdrawal(
      vaultAddress,
      sharesPlancks,
      account
    )
  },
  async getWithdrawalRequest(vaultAddress, follower) {
    await connectedAccount(follower)
    return contractService.getCopyVaultWithdrawalRequest(vaultAddress, follower)
  }
}

async function connectedAccount(follower: string) {
  const account = getWalletAccount(follower)
  if (!account) throw new Error('Reconnect your wallet to enable signing')
  if (!contractService.getIsConnected()) {
    const ok = await contractService.connect(NETWORK.name)
    if (!ok) throw new Error('Could not connect to the Lunes network')
  }
  return account
}

const fmtAmt = (v: number) =>
  (Number.isFinite(v) ? v : 0).toLocaleString('en-US', {
    maximumFractionDigits: 2
  })

/**
 * Follower positions + activity. Both are private reads served with the
 * one-signature read session (no wallet prompt). Without a session, `load`
 * sets `needsSignIn` so the page can show the "Sign in" fallback.
 */
export const useCopyPositions = () => {
  const [positions, setPositions] = useState<CopytradePosition[]>([])
  const [activity, setActivity] = useState<CopytradeActivityItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [needsSignIn, setNeedsSignIn] = useState(false)

  const load = useCallback(
    async (address: string, opts: { withActivity?: boolean } = {}) => {
      setLoading(true)
      setError('')
      try {
        const auth = requireReadAuth(address)
        setNeedsSignIn(false)
        const nextPositions = await socialApi.getPositions(address, auth)
        setPositions(nextPositions)

        if (opts.withActivity) {
          const nextActivity = await socialApi.getActivity(address, auth, 20)
          setActivity(nextActivity)
        }
        setLoadedFor(address)
      } catch (err: unknown) {
        if (err instanceof ReadSessionRequiredError) {
          setNeedsSignIn(true)
          return
        }
        setError(
          err instanceof Error ? err.message : 'Could not load your positions'
        )
      } finally {
        setLoading(false)
      }
    },
    []
  )

  const reset = useCallback(() => {
    setPositions([])
    setActivity([])
    setLoadedFor(null)
    setError('')
  }, [])

  return {
    positions,
    activity,
    loading,
    loadedFor,
    error,
    needsSignIn,
    load,
    reset
  }
}

/**
 * Deposit into a leader's copy vault through the shared tx flow. The
 * follower's wallet signs the on-chain CopyVault deposit (native LUNES) —
 * the backend never moves funds; it verifies the finalized tx before crediting.
 */
export const useCopyDeposit = () => {
  const { walletAddress, signMessage } = useSDK()
  const tx = useTx()

  return useCallback(
    (input: {
      leaderId: string
      leaderName: string
      /** ink! CopyVault contract; deposits are impossible without it. */
      vaultAddress: string | null | undefined
      token: string
      amount: string
      /** Follower-level stop-loss preference (stored on your position). */
      stopLossPct?: number
      onSuccess?: () => void
    }) => {
      if (!walletAddress) return
      const amountLabel = `${fmtAmt(Number(input.amount))} ${input.token}`
      tx.run({
        type: 'social',
        title: 'Starting copy',
        summary: `${input.leaderName} · ${amountLabel}`,
        actTitle: `Copy ${input.leaderName} · ${amountLabel}`,
        successTitle: 'Copying started',
        steps: buildCopyDepositSteps(
          {
            leaderId: input.leaderId,
            follower: walletAddress,
            vaultAddress: input.vaultAddress,
            token: input.token,
            amount: input.amount,
            stopLossPct: input.stopLossPct
          },
          { chain: vaultChain, signMessage, api: socialApi }
        ),
        onSuccess: input.onSuccess
      })
    },
    [walletAddress, signMessage, tx]
  )
}

/**
 * Withdraw shares from a copy vault through the shared tx flow. The contract
 * pays `caller`, so the follower's wallet signs `CopyVault.withdraw` itself.
 */
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
        steps: buildCopyWithdrawSteps(
          {
            leaderId: position.vault.leaderId,
            follower: position.followerAddress,
            vaultAddress: position.vault.contractAddress,
            shares
          },
          { chain: vaultChain, signMessage, api: socialApi }
        ),
        onSuccess
      })
    },
    [signMessage, tx]
  )
}
