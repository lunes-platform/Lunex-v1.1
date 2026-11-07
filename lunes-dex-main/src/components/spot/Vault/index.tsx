import React, { useCallback, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { useSpot } from 'context/SpotContext'
import { useSDK } from 'context/SDKContext'
import { useTx, type TxStep } from 'context/TxContext'
import { contractService } from 'services/contractService'
import { CONTRACTS, NETWORK } from '../../../config/contracts'
import { Button, C, Notice } from 'components/ui/kit'
import {
  Segmented,
  T,
  TField,
  TInput,
  TKV,
  TLabel,
  cleanNum,
  splitPair
} from '../terminal'
import { useSpotBalances } from '../OrderForm/useSpotBalances'
import { useSettlementMode } from './useSettlementMode'
import { notifyVaultChanged } from './vaultEvents'
import {
  fromUnits,
  planVaultSteps,
  toUnits,
  validateVaultAmount,
  vaultGate,
  type VaultGate,
  type VaultMode,
  type VaultStep
} from './vaultMath'

/** Native LUNES left in the wallet on "Max" so the deposit can pay gas. */
const NATIVE_GAS_RESERVE = '0.1'

const Wrap = styled.div`
  border-top: 1px solid ${T.line};
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const Head = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: ${C.text};
  }
`

const Rows = styled.div`
  display: flex;
  flex-direction: column;
  gap: 7px;
`

const Sub = styled.span`
  color: ${C.muted};
  font-size: 12px;
`

const MaxBtn = styled.button`
  border: none;
  background: transparent;
  color: ${C.primary};
  font-size: 12px;
  font-weight: 600;
  padding: 0;
  &:disabled {
    color: ${C.muted};
    cursor: not-allowed;
  }
`

const GATE_COPY: Record<Exclude<VaultGate['reason'], null>, string> = {
  unknown:
    'Could not confirm on-chain settlement with the exchange. Vault actions are disabled.',
  disabled:
    'Orders are matched off-chain and are NOT settled on chain in this environment. Vault deposits are disabled.',
  unconfigured:
    'The spot vault contract is not configured for this build. Vault actions are disabled.',
  mismatch:
    'This app points to a different spot vault than the one the exchange settles against. Vault actions are blocked.'
}

const STEP_LABEL: Record<VaultStep, (amt: string, sym: string) => string> = {
  approve: (a, s) => `Approve exactly ${a} ${s} for the spot vault`,
  depositNative: (a, s) => `Deposit ${a} ${s} into the spot vault`,
  depositPsp22: (a, s) => `Deposit ${a} ${s} into the spot vault`,
  withdrawNative: (a, s) => `Withdraw ${a} ${s} from the spot vault`,
  withdrawPsp22: (a, s) => `Withdraw ${a} ${s} from the spot vault`
}

/** Decimal string from spot-api → units; negative/invalid → 0. */
const safeUnits = (v: string | undefined, decimals: number): bigint => {
  try {
    return toUnits(v || '0', decimals)
  } catch {
    return 0n
  }
}

/**
 * Spot settlement vault: shows total / locked / available of the selected
 * pair's tokens (GET /api/v1/balances) and lets the user deposit/withdraw
 * with their own wallet. Every step resolves only on finality; spot-api
 * reads the vault on-chain and stays authoritative for order admission.
 */
const VaultPanel: React.FC = () => {
  const { selectedPair, pairs } = useSpot()
  const { walletAddress } = useSDK()
  const tx = useTx()
  const mode = useSettlementMode()
  const pair = useMemo(
    () => pairs.find(p => p.symbol === selectedPair),
    [pairs, selectedPair]
  )
  const [baseSym, quoteSym] = splitPair(selectedPair)
  const balances = useSpotBalances(walletAddress, selectedPair, pair)
  const gate = vaultGate({ mode, envContract: CONTRACTS.SPOT_SETTLEMENT })

  const [action, setAction] = useState<VaultMode>('deposit')
  const [which, setWhich] = useState<'base' | 'quote'>('quote')
  const [amount, setAmount] = useState('')
  const [walletUnits, setWalletUnits] = useState<bigint | null>(null)
  const [walletTick, setWalletTick] = useState(0)

  const asset = pair
    ? which === 'base'
      ? {
          sym: baseSym,
          token: pair.baseToken,
          decimals: pair.baseDecimals,
          isNative: pair.isNativeBase,
          row: balances.baseRow
        }
      : {
          sym: quoteSym,
          token: pair.quoteToken,
          decimals: pair.quoteDecimals,
          isNative: pair.isNativeQuote,
          row: balances.quoteRow
        }
    : null

  useEffect(() => setAmount(''), [selectedPair, which, action])

  // Wallet balance (deposit cap / Max). Unknown → the chain decides.
  useEffect(() => {
    setWalletUnits(null)
    if (!walletAddress || !asset || !gate.ok || action !== 'deposit') return
    let alive = true
    ;(async () => {
      if (!contractService.getIsConnected()) {
        await contractService.connect(NETWORK.name)
      }
      const raw = asset.isNative
        ? await contractService.getNativeBalance(walletAddress)
        : await contractService.getTokenBalance(asset.token, walletAddress)
      if (alive) setWalletUnits(BigInt(raw || '0'))
    })().catch(() => alive && setWalletUnits(null))
    return () => {
      alive = false
    }
    // asset identity is captured by token/isNative
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, asset?.token, asset?.isNative, gate.ok, action, walletTick])

  const availableUnits =
    asset && asset.row ? safeUnits(asset.row.available, asset.decimals) : null
  const maxUnits =
    action === 'withdraw'
      ? availableUnits
      : walletUnits === null || !asset
        ? null
        : asset.isNative
          ? (() => {
              const left = walletUnits - toUnits(NATIVE_GAS_RESERVE, asset.decimals)
              return left > 0n ? left : 0n
            })()
          : walletUnits

  let units = 0n
  let parseError: string | null = null
  if (asset && amount) {
    try {
      units = toUnits(amount, asset.decimals)
    } catch (e) {
      parseError = e instanceof Error ? e.message : 'Invalid amount'
    }
  }
  const problem =
    parseError ??
    (asset ? validateVaultAmount({ mode: action, amount: units, max: maxUnits }) : null)

  const submit = useCallback(async () => {
    if (!walletAddress || !asset || !gate.ok || problem) return
    const amt = fromUnits(units, asset.decimals)
    const unitStr = units.toString()
    const allowance =
      action === 'deposit' && !asset.isNative
        ? await contractService
            .spotVaultAllowance(walletAddress, asset.token)
            .catch(() => 0n)
        : undefined
    const plan = planVaultSteps({
      mode: action,
      isNative: asset.isNative,
      amount: units,
      allowance
    })
    const exec: Record<VaultStep, () => Promise<{ txHash: string }>> = {
      approve: () =>
        contractService.spotVaultApprove(walletAddress, asset.token, unitStr),
      depositNative: () =>
        contractService.spotVaultDepositNative(walletAddress, unitStr),
      depositPsp22: () =>
        contractService.spotVaultDepositPsp22(
          walletAddress,
          asset.token,
          unitStr
        ),
      withdrawNative: () =>
        contractService.spotVaultWithdrawNative(walletAddress, unitStr),
      withdrawPsp22: () =>
        contractService.spotVaultWithdrawPsp22(
          walletAddress,
          asset.token,
          unitStr
        )
    }
    const steps: TxStep[] = plan.map(step => ({
      label: STEP_LABEL[step](amt, asset.sym),
      wallet: true,
      run: async () => (await exec[step]()).txHash
    }))
    const verb = action === 'deposit' ? 'Deposit' : 'Withdraw'
    tx.run({
      type: 'spot',
      title: `${verb === 'Deposit' ? 'Depositing into' : 'Withdrawing from'} the spot vault`,
      summary: `${verb} ${amt} ${asset.sym}`,
      actTitle: `Spot vault ${verb.toLowerCase()} ${amt} ${asset.sym}`,
      successTitle: `${verb} finalized`,
      errorText: 'The vault transaction did not complete.',
      steps,
      onSuccess: () => {
        setAmount('')
        notifyVaultChanged()
        setWalletTick(x => x + 1)
      }
    })
  }, [walletAddress, asset, gate.ok, problem, units, action, tx])

  const fmt = (v: string | undefined) => (v === undefined ? '…' : v)

  return (
    <Wrap aria-label="Spot vault">
      <Head>
        <h3>Spot vault</h3>
        <Segmented
          ariaLabel="Vault action"
          items={[
            ['deposit', 'Deposit'],
            ['withdraw', 'Withdraw']
          ]}
          value={action}
          onChange={setAction}
        />
      </Head>

      {!gate.ok && (
        <Notice
          $tone={gate.reason === 'mismatch' ? 'critical' : 'warning'}
          style={{ fontSize: 12, padding: '10px 12px' }}
          role="status"
        >
          {GATE_COPY[gate.reason]}
        </Notice>
      )}

      {pair && (
        <Rows>
          {(
            [
              ['base', baseSym, balances.baseRow],
              ['quote', quoteSym, balances.quoteRow]
            ] as const
          ).map(([k, sym, row]) => (
            <TKV key={k}>
              <span>{sym}</span>
              <span>
                {!walletAddress
                  ? '—'
                  : `${fmt(row?.available)} avail · ${fmt(row?.locked)} locked`}
              </span>
            </TKV>
          ))}
        </Rows>
      )}

      {gate.ok && walletAddress && asset && (
        <>
          <Segmented
            ariaLabel="Vault token"
            items={[
              ['base', baseSym],
              ['quote', quoteSym]
            ]}
            value={which}
            onChange={setWhich}
          />
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Head>
              <TLabel>Amount ({asset.sym})</TLabel>
              <MaxBtn
                type="button"
                disabled={maxUnits === null || maxUnits <= 0n}
                onClick={() =>
                  maxUnits !== null &&
                  setAmount(fromUnits(maxUnits, asset.decimals))
                }
              >
                Max
              </MaxBtn>
            </Head>
            <TField>
              <TInput
                value={amount}
                onChange={e => setAmount(cleanNum(e.target.value))}
                placeholder="0"
                aria-label={`${action} amount`}
              />
              <span>{asset.sym}</span>
            </TField>
          </label>
          <Sub>
            {action === 'deposit'
              ? walletUnits === null
                ? 'Wallet balance: …'
                : `Wallet balance: ${fromUnits(walletUnits, asset.decimals)} ${asset.sym}`
              : 'Only the available amount can be withdrawn; funds locked by open orders or unsettled trades stay in the vault.'}
          </Sub>
          <Button
            size="md"
            block
            disabled={!amount || !!problem}
            onClick={() => void submit()}
          >
            {amount && problem
              ? problem
              : action === 'deposit'
                ? `Deposit ${asset.sym}`
                : `Withdraw ${asset.sym}`}
          </Button>
        </>
      )}

      {gate.ok && !walletAddress && (
        <Sub>Connect a wallet to deposit into the spot vault.</Sub>
      )}
    </Wrap>
  )
}

export default VaultPanel
