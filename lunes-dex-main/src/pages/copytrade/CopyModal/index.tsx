import React, { useCallback, useEffect, useState } from 'react'
import Modal from 'components/modal'
import * as S from './styles'
import { useSDK } from '../../../context/SDKContext'
import socialApi, {
  buildCopytradeDepositMessage,
  buildCopytradeWithdrawMessage,
  buildUnfollowLeaderMessage,
  buildWalletActionMessage,
  createSignedActionMetadata,
  CopytradePosition
} from '../../../services/socialService'

interface Trader {
  id: string
  name: string
  fee: number
  isAI: boolean
  collateralToken?: string
  minDeposit?: number
}

interface CopyModalProps {
  trader: Trader | null
  onClose: () => void
  onConfirm: (amount: string) => void | Promise<void>
}

const formatNumber = (value: number): string =>
  Number.isFinite(value)
    ? value.toLocaleString('en-US', { maximumFractionDigits: 4 })
    : '0'

const CopyModal: React.FC<CopyModalProps> = ({
  trader,
  onClose,
  onConfirm
}) => {
  const [amount, setAmount] = useState('')
  // Risk-control inputs kept as strings so the fields can be left empty.
  const [copyMultiplier, setCopyMultiplier] = useState('1')
  const [maxPerTrade, setMaxPerTrade] = useState('')
  const [stopLoss, setStopLoss] = useState('')
  const [maxDrawdown, setMaxDrawdown] = useState('')
  const [withdrawShares, setWithdrawShares] = useState('')
  const [step, setStep] = useState<1 | 2>(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [position, setPosition] = useState<CopytradePosition | null>(null)
  const [availableBalance, setAvailableBalance] = useState<number | null>(null)
  const [confirmStop, setConfirmStop] = useState(false)
  const { walletAddress, connectWallet, signMessage, getTokenBalance } =
    useSDK()

  const token = trader?.collateralToken ?? 'USDT'
  const minDeposit = trader?.minDeposit ?? 0

  const refreshPositionAndBalance = useCallback(async () => {
    if (!trader || !walletAddress) {
      setPosition(null)
      setAvailableBalance(null)
      return
    }
    // Active position for this vault (signed read) — drives the Withdraw/Stop UI.
    try {
      const auth = createSignedActionMetadata()
      const signature = await signMessage(
        buildWalletActionMessage({
          action: 'copytrade.positions',
          address: walletAddress,
          nonce: auth.nonce,
          timestamp: auth.timestamp
        })
      )
      const positions = await socialApi.getPositions(walletAddress, {
        address: walletAddress,
        nonce: auth.nonce,
        timestamp: auth.timestamp,
        signature
      })
      const mine = positions.find(
        p => p.vault.leaderId === trader.id && p.shareBalance > 0
      )
      setPosition(mine ?? null)
    } catch {
      setPosition(null)
    }
    // Spendable token balance — used to block allocation > balance on the front.
    try {
      const raw = await getTokenBalance(token, walletAddress)
      const parsed = Number(raw)
      setAvailableBalance(Number.isFinite(parsed) ? parsed : null)
    } catch {
      setAvailableBalance(null)
    }
  }, [trader, walletAddress, token, signMessage, getTokenBalance])

  useEffect(() => {
    setAmount('')
    setCopyMultiplier('1')
    setMaxPerTrade('')
    setStopLoss('')
    setMaxDrawdown('')
    setWithdrawShares('')
    setStep(1)
    setLoading(false)
    setError('')
    setInfo('')
    setConfirmStop(false)
    setPosition(null)
    setAvailableBalance(null)
    void refreshPositionAndBalance()
  }, [trader?.id, walletAddress, refreshPositionAndBalance])

  if (!trader) return null

  const exceedsBalance =
    availableBalance !== null &&
    amount !== '' &&
    Number(amount) > availableBalance

  // Range validation for the risk fields. Empty optional fields are valid;
  // copyMultiplier is required (defaults to 1). Returns the first error message.
  const riskError = ((): string => {
    const mult = Number(copyMultiplier)
    if (copyMultiplier === '' || !Number.isFinite(mult)) {
      return 'Copy multiplier is required.'
    }
    if (mult < 0.1 || mult > 10) {
      return 'Copy multiplier must be between 0.1 and 10.'
    }
    if (maxPerTrade !== '') {
      const v = Number(maxPerTrade)
      if (!Number.isFinite(v) || v < 0) {
        return 'Max per trade must be 0 or greater.'
      }
    }
    if (stopLoss !== '') {
      const v = Number(stopLoss)
      if (!Number.isFinite(v) || v < 1 || v > 100) {
        return 'Stop-loss must be between 1 and 100%.'
      }
    }
    if (maxDrawdown !== '') {
      const v = Number(maxDrawdown)
      if (!Number.isFinite(v) || v < 1 || v > 100) {
        return 'Max drawdown must be between 1 and 100%.'
      }
    }
    return ''
  })()

  // Build the optional risk payload (only include set/valid fields).
  const buildRiskPayload = () => ({
    copyMultiplier: Number(copyMultiplier),
    maxPerTradeUsdt: maxPerTrade !== '' ? Number(maxPerTrade) : undefined,
    stopLossPct: stopLoss !== '' ? Number(stopLoss) : undefined,
    maxDrawdownPct: maxDrawdown !== '' ? Number(maxDrawdown) : undefined
  })

  const handleAction = async () => {
    if (!amount || Number(amount) <= 0) return
    if (minDeposit > 0 && Number(amount) < minDeposit) {
      setError(`Minimum deposit is ${String(minDeposit)} ${token}`)
      return
    }
    if (exceedsBalance) {
      setError(
        `Amount exceeds your available balance (${formatNumber(
          availableBalance ?? 0
        )} ${token}).`
      )
      return
    }
    if (riskError) {
      setError(riskError)
      return
    }

    if (!walletAddress) {
      try {
        await connectWallet()
        setError('Wallet connected. Click again to continue.')
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to connect wallet'
        )
      }
      return
    }

    setError('')
    setLoading(true)

    try {
      if (step === 1) {
        await new Promise(resolve => setTimeout(resolve, 600))
        setStep(2)
        return
      }

      const risk = buildRiskPayload()
      const auth = createSignedActionMetadata()
      const signature = await signMessage(
        buildCopytradeDepositMessage({
          leaderId: trader.id,
          followerAddress: walletAddress,
          token,
          amount,
          ...risk,
          nonce: auth.nonce,
          timestamp: auth.timestamp
        })
      )

      await socialApi.depositToVault(trader.id, {
        followerAddress: walletAddress,
        token,
        amount,
        ...risk,
        nonce: auth.nonce,
        timestamp: auth.timestamp,
        signature
      })

      await onConfirm(amount)
      onClose()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to deposit into vault'
      )
    } finally {
      setLoading(false)
    }
  }

  // Withdraw a given amount of shares from the vault (signed copytrade.withdraw).
  const withdraw = async (shares: string): Promise<boolean> => {
    if (!walletAddress || !position) return false
    if (!shares || Number(shares) <= 0) {
      setError('Enter a number of shares to withdraw.')
      return false
    }
    if (Number(shares) > position.shareBalance) {
      setError(`You only hold ${formatNumber(position.shareBalance)} shares.`)
      return false
    }
    const auth = createSignedActionMetadata()
    const signature = await signMessage(
      buildCopytradeWithdrawMessage({
        leaderId: trader.id,
        followerAddress: walletAddress,
        shares,
        nonce: auth.nonce,
        timestamp: auth.timestamp
      })
    )
    const result = await socialApi.withdrawFromVault(trader.id, {
      followerAddress: walletAddress,
      shares,
      nonce: auth.nonce,
      timestamp: auth.timestamp,
      signature
    })
    setInfo(
      `Withdraw successful. Net received: ${formatNumber(
        result.netAmount
      )} ${result.collateralToken ?? token}.`
    )
    return true
  }

  const handleWithdraw = async () => {
    if (!walletAddress) {
      await connectWallet()
      setError('Wallet connected. Click withdraw again to continue.')
      return
    }
    setError('')
    setInfo('')
    setLoading(true)
    try {
      const ok = await withdraw(withdrawShares)
      if (ok) {
        setWithdrawShares('')
        await refreshPositionAndBalance()
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to withdraw from vault'
      )
    } finally {
      setLoading(false)
    }
  }

  // Stop copying: withdraw the full share balance, then unfollow the leader.
  const handleStopCopying = async () => {
    if (!walletAddress || !position) return
    if (!confirmStop) {
      setConfirmStop(true)
      return
    }
    setError('')
    setInfo('')
    setLoading(true)
    try {
      if (position.shareBalance > 0) {
        await withdraw(String(position.shareBalance))
      }
      const auth = createSignedActionMetadata()
      const signature = await signMessage(
        buildUnfollowLeaderMessage({
          leaderId: trader.id,
          address: walletAddress,
          nonce: auth.nonce,
          timestamp: auth.timestamp
        })
      )
      await socialApi.unfollowLeader(trader.id, {
        address: walletAddress,
        nonce: auth.nonce,
        timestamp: auth.timestamp,
        signature
      })
      setConfirmStop(false)
      setInfo(`Stopped copying ${trader.name}. Funds withdrawn to your wallet.`)
      await refreshPositionAndBalance()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to stop copying'
      // Backend surfaces open-position guards on unfollow/withdraw — relay them.
      setError(
        /open|position|pending/i.test(message)
          ? `${message} Close or wait for open positions to settle before stopping.`
          : message
      )
    } finally {
      setLoading(false)
    }
  }

  const hasPosition = !!position && position.shareBalance > 0

  return (
    <Modal
      divider
      width="520px"
      justify="space-between"
      closeX={onClose}
      closeExternal={onClose}
      titleModal="Copy Trader Vault"
      description="Review the leader terms, manage your allocation, withdraw, or stop copying at any time."
    >
      <S.ContentArea>
        <S.LeaderCard>
          <S.InfoRow>
            <span>Target Leader</span>
            <strong>{trader.name}</strong>
          </S.InfoRow>
          <S.InfoRow>
            <span>Performance Fee (HWM)</span>
            <S.AccentValue>{trader.fee}% on Profits</S.AccentValue>
          </S.InfoRow>
          <S.InfoRow>
            <span>Minimum Deposit</span>
            <strong>
              {String(minDeposit || 0)} {token}
            </strong>
          </S.InfoRow>
          <S.InfoRow>
            <span>Network</span>
            <strong>Lunes Network</strong>
          </S.InfoRow>
        </S.LeaderCard>

        {hasPosition && position ? (
          <S.PositionCard>
            <S.InfoRow>
              <span>Your Shares</span>
              <strong>{formatNumber(position.shareBalance)}</strong>
            </S.InfoRow>
            <S.InfoRow>
              <span>Current Value</span>
              <strong>
                {formatNumber(position.currentValue)} {token}
              </strong>
            </S.InfoRow>
            <S.InfoRow>
              <span>Net Deposited</span>
              <strong>
                {formatNumber(position.netDeposited)} {token}
              </strong>
            </S.InfoRow>
          </S.PositionCard>
        ) : null}

        <S.Label>Amount to Deposit</S.Label>
        <S.InputHint>
          Enter the amount you want this leader to manage on your behalf.
        </S.InputHint>
        <S.InputWrapper>
          <S.Input
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={e => setAmount(e.target.value)}
          />
          <S.CurrencyLabel>{token}</S.CurrencyLabel>
        </S.InputWrapper>

        <S.BalanceInfo>
          <span>
            {availableBalance !== null
              ? `Available: ${formatNumber(availableBalance)} ${token}`
              : 'Balance is validated by your connected wallet and backend checks during deposit.'}
          </span>
          {availableBalance !== null ? (
            <S.MaxBtn
              type="button"
              onClick={() => setAmount(String(availableBalance))}
            >
              Max
            </S.MaxBtn>
          ) : null}
        </S.BalanceInfo>

        <S.RiskSection>
          <S.Label>Risk Controls</S.Label>
          <S.InputHint>
            Set how aggressively this leader trades on your behalf. Tighter
            limits reduce risk but may skip larger moves.
          </S.InputHint>
          <S.RiskGrid>
            <S.RiskField>
              <S.LabelRow>
                <S.Label as="span">Copy Multiplier</S.Label>
                <S.Tooltip data-tip="Scales each copied trade size relative to the leader. 1 = same size, 2 = double, 0.5 = half. Range 0.1–10.">
                  ?
                </S.Tooltip>
              </S.LabelRow>
              <S.SmallInputWrapper>
                <S.SmallInput
                  type="number"
                  min="0.1"
                  max="10"
                  step="0.1"
                  placeholder="1"
                  value={copyMultiplier}
                  onChange={e => setCopyMultiplier(e.target.value)}
                />
                <S.SmallUnit>x</S.SmallUnit>
              </S.SmallInputWrapper>
            </S.RiskField>

            <S.RiskField>
              <S.LabelRow>
                <S.Label as="span">Max Per Trade</S.Label>
                <S.Tooltip data-tip="Optional cap on the notional size of any single copied trade. Leave empty for no cap.">
                  ?
                </S.Tooltip>
              </S.LabelRow>
              <S.SmallInputWrapper>
                <S.SmallInput
                  type="number"
                  min="0"
                  step="any"
                  placeholder="No cap"
                  value={maxPerTrade}
                  onChange={e => setMaxPerTrade(e.target.value)}
                />
                <S.SmallUnit>USDT</S.SmallUnit>
              </S.SmallInputWrapper>
            </S.RiskField>

            <S.RiskField>
              <S.LabelRow>
                <S.Label as="span">Stop-Loss</S.Label>
                <S.Tooltip data-tip="Optional. Closes your position if it loses this percentage. Range 1–100%.">
                  ?
                </S.Tooltip>
              </S.LabelRow>
              <S.SmallInputWrapper>
                <S.SmallInput
                  type="number"
                  min="1"
                  max="100"
                  step="any"
                  placeholder="Off"
                  value={stopLoss}
                  onChange={e => setStopLoss(e.target.value)}
                />
                <S.SmallUnit>%</S.SmallUnit>
              </S.SmallInputWrapper>
            </S.RiskField>

            <S.RiskField>
              <S.LabelRow>
                <S.Label as="span">Max Drawdown</S.Label>
                <S.Tooltip data-tip="Optional. Stops copying if your equity falls this percentage from its peak. Range 1–100%.">
                  ?
                </S.Tooltip>
              </S.LabelRow>
              <S.SmallInputWrapper>
                <S.SmallInput
                  type="number"
                  min="1"
                  max="100"
                  step="any"
                  placeholder="Off"
                  value={maxDrawdown}
                  onChange={e => setMaxDrawdown(e.target.value)}
                />
                <S.SmallUnit>%</S.SmallUnit>
              </S.SmallInputWrapper>
            </S.RiskField>
          </S.RiskGrid>
          {riskError ? <S.ErrorBox>{riskError}</S.ErrorBox> : null}
        </S.RiskSection>

        {hasPosition && position ? (
          <S.ManageSection>
            <S.Label>Withdraw Shares</S.Label>
            <S.InputHint>
              Redeem part or all of your vault shares back to your wallet.
            </S.InputHint>
            <S.InputWrapper>
              <S.Input
                type="number"
                placeholder="0.00"
                value={withdrawShares}
                onChange={e => setWithdrawShares(e.target.value)}
              />
              <S.CurrencyLabel>SHARES</S.CurrencyLabel>
            </S.InputWrapper>
            <S.BalanceInfo>
              <span>Holding: {formatNumber(position.shareBalance)} shares</span>
              <S.MaxBtn
                type="button"
                onClick={() => setWithdrawShares(String(position.shareBalance))}
              >
                Max
              </S.MaxBtn>
            </S.BalanceInfo>
            <S.Actions>
              <S.Button
                disabled={
                  loading || !withdrawShares || Number(withdrawShares) <= 0
                }
                onClick={() => {
                  handleWithdraw().catch(() => undefined)
                }}
              >
                {loading ? 'Processing...' : 'Withdraw'}
              </S.Button>
              <S.DangerButton
                disabled={loading}
                onClick={() => {
                  handleStopCopying().catch(() => undefined)
                }}
              >
                {confirmStop ? 'Confirm: Withdraw all & Stop' : 'Stop copying'}
              </S.DangerButton>
            </S.Actions>
            {confirmStop ? (
              <S.InputHint>
                This withdraws your entire balance and unfollows the leader.
              </S.InputHint>
            ) : null}
          </S.ManageSection>
        ) : null}

        <S.WarningBox>
          <p>
            By depositing funds, this Trader/AI will automatically execute
            trades on your behalf. The leader takes a {trader.fee}% fee{' '}
            <b>only</b> on positive net profits. You can withdraw or stop
            copying at any time.
          </p>
        </S.WarningBox>

        {info ? <S.SuccessBox>{info}</S.SuccessBox> : null}
        {error ? <S.ErrorBox>{error}</S.ErrorBox> : null}

        <S.Actions>
          <S.Button onClick={onClose}>Cancel</S.Button>
          <S.Button
            primary
            disabled={
              !amount ||
              Number(amount) <= 0 ||
              loading ||
              Number(amount) < minDeposit ||
              exceedsBalance ||
              !!riskError
            }
            onClick={handleAction}
          >
            {loading
              ? 'Processing...'
              : !walletAddress
                ? 'Connect Wallet'
                : step === 1
                  ? `Approve ${token}`
                  : 'Deposit in Vault'}
          </S.Button>
        </S.Actions>
      </S.ContentArea>
    </Modal>
  )
}

export default CopyModal
