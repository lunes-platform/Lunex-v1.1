/**
 * CopyVault deposit / withdraw flows (BE-01 / BE-02).
 *
 * Funds move ONLY through a tx the follower's own wallet signs on the ink!
 * CopyVault contract (the contract credits / pays `caller`). The order is:
 *
 *   1. wallet signs `CopyVault.deposit` (payable) / `CopyVault.withdraw`
 *      → resolves only when the block is FINALIZED → { txHash, blockHash }
 *   2. wallet signs the API receipt binding that proof (+ amount / shares)
 *   3. API verifies the finalized tx on chain and journals it
 *
 * The backend is the source of truth for crediting; this module only prepares
 * payloads and drives the wallet. Kept free of React so it is unit-testable.
 */
import type { TxStep } from '../../context/TxContext'
import socialApi, {
  buildCopytradeDepositMessage,
  buildCopytradeWithdrawMessage,
  createSignedActionMetadata,
  type VaultTxProof
} from '../../services/socialService'
import { lunesToPlancks } from './vaultUnits'

export type CopyVaultChain = {
  deposit: (
    vaultAddress: string,
    amountPlancks: string,
    follower: string
  ) => Promise<VaultTxProof>
  withdraw: (
    vaultAddress: string,
    sharesPlancks: string,
    follower: string
  ) => Promise<VaultTxProof>
  /** Starts the contract's 24h cooldown for a large withdrawal. */
  requestWithdrawal: (
    vaultAddress: string,
    sharesPlancks: string,
    follower: string
  ) => Promise<VaultTxProof>
  getWithdrawalRequest: (
    vaultAddress: string,
    follower: string
  ) => Promise<{ shares: string; unlockAt: number } | null>
}

export type CopyFlowDeps = {
  chain: CopyVaultChain
  signMessage: (message: string) => Promise<string>
  api: Pick<typeof socialApi, 'depositToVault' | 'withdrawFromVault'>
}

const NOT_LIVE = 'This copy vault is not live on-chain yet'

function requireVault(address: string | null | undefined): string {
  if (!address) throw new Error(NOT_LIVE)
  return address
}

function isCooldownError(err: unknown): boolean {
  return err instanceof Error && /CooldownActive/.test(err.message)
}

function fmtUnlock(ms: number): string {
  return new Date(ms).toLocaleString()
}

/**
 * The contract requires `request_withdrawal` + 24h before burning more than
 * 10% of the vault shares. Starts it (unless a pending request already covers
 * these shares) and always throws: nothing is withdrawn in this run.
 */
async function startLargeWithdrawalCooldown(
  chain: CopyVaultChain,
  vault: string,
  sharesPlancks: string,
  follower: string
): Promise<never> {
  const pending = await chain.getWithdrawalRequest(vault, follower)
  if (pending && BigInt(pending.shares) >= BigInt(sharesPlancks)) {
    throw new Error(
      `Large withdrawal unlocks at ${fmtUnlock(pending.unlockAt)}. Try again then.`
    )
  }
  await chain.requestWithdrawal(vault, sharesPlancks, follower)
  const started = await chain.getWithdrawalRequest(vault, follower)
  const when = started ? fmtUnlock(started.unlockAt) : 'the 24h cooldown'
  throw new Error(
    `Withdrawals above 10% of the vault need a 24h cooldown: requested on-chain. Withdraw again after ${when}.`
  )
}

export function buildCopyDepositSteps(
  input: {
    leaderId: string
    follower: string
    vaultAddress: string | null | undefined
    token: string
    amount: string
    stopLossPct?: number
  },
  deps: CopyFlowDeps
): TxStep[] {
  let proof: VaultTxProof | null = null
  let auth = createSignedActionMetadata()
  let signature = ''

  return [
    {
      label: 'Confirm the deposit in your wallet',
      wallet: true,
      run: async () => {
        const vault = requireVault(input.vaultAddress)
        const plancks = lunesToPlancks(input.amount)
        proof = await deps.chain.deposit(vault, plancks, input.follower)
        return proof.txHash
      }
    },
    {
      label: 'Sign the deposit receipt',
      wallet: true,
      run: async () => {
        if (!proof) throw new Error('Missing on-chain deposit proof')
        auth = createSignedActionMetadata()
        signature = await deps.signMessage(
          buildCopytradeDepositMessage({
            leaderId: input.leaderId,
            followerAddress: input.follower,
            token: input.token,
            amount: input.amount,
            stopLossPct: input.stopLossPct,
            txHash: proof.txHash,
            blockHash: proof.blockHash,
            nonce: auth.nonce,
            timestamp: auth.timestamp
          })
        )
        return true
      }
    },
    {
      label: 'Recording your position',
      run: async () => {
        if (!proof) throw new Error('Missing on-chain deposit proof')
        const res = await deps.api.depositToVault(input.leaderId, {
          followerAddress: input.follower,
          token: input.token,
          amount: input.amount,
          stopLossPct: input.stopLossPct,
          txHash: proof.txHash,
          blockHash: proof.blockHash,
          nonce: auth.nonce,
          timestamp: auth.timestamp,
          signature
        })
        return res.txHash || proof.txHash
      }
    }
  ]
}

export function buildCopyWithdrawSteps(
  input: {
    leaderId: string
    follower: string
    vaultAddress: string | null | undefined
    shares: string
  },
  deps: CopyFlowDeps
): TxStep[] {
  let proof: VaultTxProof | null = null
  let auth = createSignedActionMetadata()
  let signature = ''

  return [
    {
      label: 'Confirm the withdrawal in your wallet',
      wallet: true,
      run: async () => {
        const vault = requireVault(input.vaultAddress)
        const sharesPlancks = lunesToPlancks(input.shares)
        try {
          proof = await deps.chain.withdraw(
            vault,
            sharesPlancks,
            input.follower
          )
        } catch (err: unknown) {
          if (!isCooldownError(err)) throw err
          await startLargeWithdrawalCooldown(
            deps.chain,
            vault,
            sharesPlancks,
            input.follower
          )
        }
        if (!proof) throw new Error('Missing on-chain withdrawal proof')
        return proof.txHash
      }
    },
    {
      label: 'Sign the withdrawal receipt',
      wallet: true,
      run: async () => {
        if (!proof) throw new Error('Missing on-chain withdrawal proof')
        auth = createSignedActionMetadata()
        signature = await deps.signMessage(
          buildCopytradeWithdrawMessage({
            leaderId: input.leaderId,
            followerAddress: input.follower,
            shares: input.shares,
            txHash: proof.txHash,
            blockHash: proof.blockHash,
            nonce: auth.nonce,
            timestamp: auth.timestamp
          })
        )
        return true
      }
    },
    {
      label: 'Recording your withdrawal',
      run: async () => {
        if (!proof) throw new Error('Missing on-chain withdrawal proof')
        const res = await deps.api.withdrawFromVault(input.leaderId, {
          followerAddress: input.follower,
          shares: input.shares,
          txHash: proof.txHash,
          blockHash: proof.blockHash,
          nonce: auth.nonce,
          timestamp: auth.timestamp,
          signature
        })
        return res.txHash || proof.txHash
      }
    }
  ]
}
