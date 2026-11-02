import React, { useCallback, useEffect, useState } from 'react'
import styled, { css } from 'styled-components'
import { Check } from 'lucide-react'
import { useSpot } from 'context/SpotContext'
import { useSDK } from 'context/SDKContext'
import { useTx } from 'context/TxContext'
import {
  marginApi,
  MarginOverview,
  MarginPositionOverview
} from 'services/marginService'
import {
  buildMarginClosePositionSignMessage,
  buildMarginCollateralSignMessage,
  buildMarginLiquidatePositionSignMessage,
  buildMarginOpenPositionSignMessage,
  buildWalletActionMessage,
  createSignedActionMetadata
} from '../../../utils/signing'
import { Button, C, EASE_OUT, grotesk, tabular } from 'components/ui/kit'
import AnimatedNumber from 'components/ui/AnimatedNumber'
import { drawStroke, riseIn } from '../../../styles/motion'
import {
  SideBtn,
  SideSwitch,
  T,
  TField,
  TInput,
  TLabel,
  cleanNum,
  fmtAmt,
  fmtPx
} from '../terminal'

const LEVERAGES = [2, 3, 5, 10] as const
const RISK_ACK_FROM = 5
// UI guard mirroring spot-api MAX_SAFE_INITIAL_LEVERAGE (7.9×). The risk
// engine stays authoritative — it rejects anything above its own limit.
const RISK_ENGINE_MAX_LEVERAGE = 7.9
// Collateral token label used by the margin API
const COLLATERAL = 'USDT'

const Wrap = styled.div`
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
`

const Stats = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
`

const StatTile = styled.div`
  padding: 10px;
  border-radius: 10px;
  background: ${T.input};
  min-width: 0;
  > div:first-child {
    font-size: 10px;
    color: ${C.muted};
    margin-bottom: 3px;
  }
  > div:last-child {
    ${grotesk};
    ${tabular};
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`

const Section = styled.div<{ $gap?: number }>`
  display: flex;
  flex-direction: column;
  gap: ${p => p.$gap ?? 8}px;
`

const Title = styled.span`
  ${grotesk};
  font-weight: 600;
  font-size: 13px;
`

const Inline = styled.div`
  display: flex;
  gap: 6px;
  > [data-field] {
    flex: 1;
    height: 40px;
    padding: 0 10px;
  }
`

const Levs = styled.div`
  display: flex;
  gap: 6px;
`

const Lev = styled.button<{ $on: boolean }>`
  flex: 1;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: ${p => (p.$on ? C.primary : T.line)};
  color: ${C.text};
  font-weight: 600;
  font-size: 12px;
  ${tabular};
  transition: background-color 150ms ease;
  &:disabled {
    color: ${C.muted};
    cursor: not-allowed;
  }
`

const KV = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  span:first-child {
    color: ${C.muted};
  }
  span:last-child {
    ${tabular};
    font-weight: 500;
  }
`

const Ack = styled.button<{ $on: boolean }>`
  display: flex;
  gap: 10px;
  align-items: flex-start;
  text-align: left;
  width: 100%;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 93, 105, 0.45);
  background: rgba(255, 40, 76, 0.08);
  color: ${C.text};
  font-size: 13px;
  line-height: 1.45;
  animation: ${riseIn} 200ms ${EASE_OUT};
  > i {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    margin-top: 1px;
    border-radius: 5px;
    border: 1.5px solid ${p => (p.$on ? C.primary : C.muted)};
    background: ${p => (p.$on ? C.primary : 'transparent')};
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      background-color 150ms ease,
      border-color 150ms ease;
  }
  path {
    stroke-dasharray: 24;
    animation: ${drawStroke} 250ms ease both;
  }
`

const Cta = styled(Button)<{ $tone: 'buy' | 'sell' | 'primary' }>`
  ${p =>
    p.$tone === 'buy'
      ? css`
          background: ${T.up};
          color: ${T.bg};
          &:hover:not(:disabled) {
            background: #1bb277;
          }
        `
      : p.$tone === 'sell'
        ? css`
            background: ${T.sell};
            &:hover:not(:disabled) {
              background: #db1d4e;
            }
          `
        : ''}
`

const NoPos = styled.div`
  padding: 14px;
  border-radius: 10px;
  border: 1px dashed ${C.borderStrong};
  text-align: center;
  font-size: 12px;
  color: ${C.muted};
`

const Pos = styled.div`
  padding: 12px;
  border-radius: 12px;
  background: ${T.input};
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
  animation: ${riseIn} 200ms ${EASE_OUT};
`

const PosHead = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  > span {
    font-weight: 600;
    font-size: 13px;
  }
  > div {
    display: flex;
    gap: 6px;
  }
`

const SmallBtn = styled.button<{ $danger?: boolean }>`
  height: 24px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid ${C.borderStrong};
  background: transparent;
  color: ${p => (p.$danger ? T.downText : C.text)};
  font-size: 11px;
  font-weight: 600;
  &:hover:not(:disabled) {
    border-color: ${p => (p.$danger ? T.down : C.primary)};
  }
  &:disabled {
    color: ${C.muted};
    cursor: not-allowed;
  }
`

const PosGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  color: ${C.muted};
  b {
    ${tabular};
    font-weight: 500;
    color: ${C.text};
  }
`

const ErrorLine = styled.div`
  font-size: 12px;
  color: ${T.downText};
`

/**
 * Isolated margin (spot-api risk engine). Every fund-moving action is
 * signed in the wallet and run through the shared tx flow.
 */
const MarginTab: React.FC = () => {
  const { selectedPair, ticker } = useSpot()
  const { walletAddress, connectWallet, signMessage } = useSDK()
  const tx = useTx()
  const [overview, setOverview] = useState<MarginOverview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dep, setDep] = useState('')
  const [coll, setColl] = useState('')
  const [dir, setDir] = useState<'long' | 'short'>('long')
  const [lev, setLev] = useState<number>(3)
  const [ack, setAck] = useState(false)

  const mark = ticker?.symbol === selectedPair ? ticker.lastPrice : 0

  // Reading the account needs a signed read action (existing behaviour).
  const load = useCallback(async () => {
    if (!walletAddress) {
      setOverview(null)
      return
    }
    const meta = createSignedActionMetadata()
    const signature = await signMessage(
      buildWalletActionMessage({
        action: 'margin.overview',
        address: walletAddress,
        nonce: meta.nonce,
        timestamp: meta.timestamp
      })
    )
    setOverview(
      await marginApi.getOverview(walletAddress, {
        nonce: meta.nonce,
        timestamp: meta.timestamp,
        signature
      })
    )
    setLoadError(null)
  }, [walletAddress, signMessage])

  useEffect(() => {
    load().catch((err: unknown) =>
      setLoadError(
        err instanceof Error ? err.message : 'Could not load margin account'
      )
    )
  }, [load])

  useEffect(() => setAck(false), [lev, dir])

  const connected = !!walletAddress
  const acct = overview?.account
  const available = acct?.collateralAvailable ?? 0
  const mc = parseFloat(coll) || 0
  const liqEst =
    mark > 0
      ? dir === 'long'
        ? mark * (1 - 0.9 / lev)
        : mark * (1 + 0.9 / lev)
      : 0
  const needsAck = lev >= RISK_ACK_FROM
  const positions = (overview?.positions || []).filter(p => p.status === 'OPEN')

  const deposit = (action: 'deposit' | 'withdraw') => {
    const amount = parseFloat(dep) || 0
    if (!walletAddress || amount <= 0) return
    const amountStr = String(amount)
    const meta = createSignedActionMetadata()
    let signature = ''
    tx.run({
      type: 'spot',
      title:
        action === 'deposit'
          ? 'Depositing collateral'
          : 'Withdrawing collateral',
      summary: `${fmtAmt(amount)} ${COLLATERAL}`,
      actTitle: `Margin ${action} ${fmtAmt(amount)} ${COLLATERAL}`,
      successTitle:
        action === 'deposit' ? 'Collateral deposited' : 'Collateral withdrawn',
      steps: [
        {
          label: `Sign ${action} in your wallet`,
          wallet: true,
          run: async () => {
            signature = await signMessage(
              buildMarginCollateralSignMessage({
                address: walletAddress,
                action,
                token: COLLATERAL,
                amount: amountStr,
                nonce: meta.nonce,
                timestamp: meta.timestamp
              })
            )
          }
        },
        {
          label: 'Updating margin account',
          run: async () => {
            const input = {
              address: walletAddress,
              token: COLLATERAL,
              amount: amountStr,
              nonce: meta.nonce,
              timestamp: meta.timestamp,
              signature
            }
            const res =
              action === 'deposit'
                ? await marginApi.depositCollateral(input)
                : await marginApi.withdrawCollateral(input)
            setOverview(o => (o ? { ...o, account: res.account } : o))
          }
        }
      ],
      onSuccess: () => setDep('')
    })
  }

  const open = () => {
    if (!walletAddress) return
    const side = dir === 'long' ? 'BUY' : 'SELL'
    const collateralAmount = String(mc)
    const leverage = String(lev)
    const meta = createSignedActionMetadata()
    let signature = ''
    const label = `${dir === 'long' ? 'Long' : 'Short'} ${selectedPair} · ${lev}×`
    tx.run({
      type: 'spot',
      title: 'Opening position',
      summary: `${label} · ${fmtAmt(mc)} ${COLLATERAL}`,
      actTitle: `Margin ${dir} ${selectedPair} ${lev}×`,
      successTitle: 'Position opened',
      steps: [
        {
          label: 'Sign position in your wallet',
          wallet: true,
          run: async () => {
            signature = await signMessage(
              buildMarginOpenPositionSignMessage({
                address: walletAddress,
                pairSymbol: selectedPair,
                side,
                collateralAmount,
                leverage,
                nonce: meta.nonce,
                timestamp: meta.timestamp
              })
            )
          }
        },
        {
          label: 'Opening on the risk engine',
          run: async () => {
            const res = await marginApi.openPosition({
              address: walletAddress,
              pairSymbol: selectedPair,
              side,
              collateralAmount,
              leverage,
              nonce: meta.nonce,
              timestamp: meta.timestamp,
              signature
            })
            setOverview(res.overview)
          }
        }
      ],
      onSuccess: () => {
        setColl('')
        setAck(false)
      }
    })
  }

  const settle = (p: MarginPositionOverview, kind: 'close' | 'liquidate') => {
    if (!walletAddress) return
    const meta = createSignedActionMetadata()
    let signature = ''
    const what = `${p.side === 'BUY' ? 'Long' : 'Short'} ${p.pairSymbol}`
    tx.run({
      type: 'spot',
      title: kind === 'close' ? 'Closing position' : 'Liquidating position',
      summary: `${what} · ${p.leverage}×`,
      actTitle: `${kind === 'close' ? 'Close' : 'Liquidate'} ${what}`,
      successTitle:
        kind === 'close' ? 'Position closed' : 'Position liquidated',
      steps: [
        {
          label: `Sign ${kind} in your wallet`,
          wallet: true,
          run: async () => {
            const build =
              kind === 'close'
                ? buildMarginClosePositionSignMessage
                : buildMarginLiquidatePositionSignMessage
            signature = await signMessage(
              build({
                address: walletAddress,
                positionId: p.id,
                nonce: meta.nonce,
                timestamp: meta.timestamp
              })
            )
          }
        },
        {
          label: 'Settling on the risk engine',
          run: async () => {
            const next =
              kind === 'close'
                ? await marginApi.closePosition({
                    positionId: p.id,
                    address: walletAddress,
                    nonce: meta.nonce,
                    timestamp: meta.timestamp,
                    signature
                  })
                : await marginApi.liquidatePosition({
                    positionId: p.id,
                    liquidatorAddress: walletAddress,
                    nonce: meta.nonce,
                    timestamp: meta.timestamp,
                    signature
                  })
            setOverview(next)
          }
        }
      ]
    })
  }

  let cta: { label: string; ok: boolean; on?: () => void }
  if (!connected)
    cta = { label: 'Connect wallet', ok: true, on: () => void connectWallet() }
  else if (mc <= 0) cta = { label: 'Enter collateral', ok: false }
  else if (overview && mc > available)
    cta = { label: 'Not enough collateral', ok: false }
  else if (needsAck && !ack)
    cta = { label: 'Confirm the liquidation risk', ok: false }
  else cta = { label: `Open ${dir} ${lev}×`, ok: true, on: open }

  const fmtU = (v?: number) =>
    connected && overview ? `${fmtAmt(v ?? 0)} ${COLLATERAL}` : '—'

  return (
    <Wrap>
      <Stats>
        <StatTile>
          <div>Available</div>
          <div>
            <AnimatedNumber text={fmtU(acct?.collateralAvailable)} />
          </div>
        </StatTile>
        <StatTile>
          <div>Locked</div>
          <div>
            <AnimatedNumber text={fmtU(acct?.collateralLocked)} />
          </div>
        </StatTile>
        <StatTile>
          <div>Equity</div>
          <div>
            <AnimatedNumber text={fmtU(acct?.totalEquity)} />
          </div>
        </StatTile>
      </Stats>
      {loadError && connected && (
        <ErrorLine role="alert">{loadError}</ErrorLine>
      )}

      <Section>
        <Title>Collateral</Title>
        <Inline>
          <TField>
            <TInput
              value={dep}
              onChange={e => setDep(cleanNum(e.target.value))}
              placeholder="0"
              aria-label="Collateral amount"
            />
            <span>{COLLATERAL}</span>
          </TField>
          <Button
            variant="secondary"
            size="md"
            disabled={!connected || !(parseFloat(dep) > 0)}
            onClick={() => deposit('deposit')}
          >
            Deposit
          </Button>
          <Button
            variant="ghost"
            size="md"
            disabled={!connected || !(parseFloat(dep) > 0)}
            onClick={() => deposit('withdraw')}
          >
            Withdraw
          </Button>
        </Inline>
      </Section>

      <Section $gap={10}>
        <Title>Open position · {selectedPair}</Title>
        <SideSwitch role="tablist" aria-label="Direction">
          <SideBtn
            role="tab"
            aria-selected={dir === 'long'}
            $on={dir === 'long'}
            $side="buy"
            onClick={() => setDir('long')}
          >
            Long
          </SideBtn>
          <SideBtn
            role="tab"
            aria-selected={dir === 'short'}
            $on={dir === 'short'}
            $side="sell"
            onClick={() => setDir('short')}
          >
            Short
          </SideBtn>
        </SideSwitch>
        <Section $gap={6}>
          <TLabel>Collateral</TLabel>
          <TField>
            <TInput
              value={coll}
              onChange={e => setColl(cleanNum(e.target.value))}
              placeholder="0"
              aria-label="Position collateral"
            />
            <span>{COLLATERAL}</span>
          </TField>
        </Section>
        <Section $gap={6}>
          <TLabel>Leverage</TLabel>
          <Levs role="radiogroup" aria-label="Leverage">
            {LEVERAGES.map(v => (
              <Lev
                key={v}
                role="radio"
                aria-checked={lev === v}
                $on={lev === v}
                disabled={v > RISK_ENGINE_MAX_LEVERAGE}
                title={
                  v > RISK_ENGINE_MAX_LEVERAGE
                    ? `The risk engine currently caps initial leverage at ${RISK_ENGINE_MAX_LEVERAGE}×`
                    : undefined
                }
                onClick={() => setLev(v)}
              >
                {v}×
              </Lev>
            ))}
          </Levs>
        </Section>
        <Section $gap={7}>
          <KV>
            <span>Position size</span>
            <span>{mc > 0 ? `${fmtAmt(mc * lev)} ${COLLATERAL}` : '—'}</span>
          </KV>
          <KV>
            <span>Entry (mark)</span>
            <span>{fmtPx(mark)}</span>
          </KV>
          <KV>
            <span>Est. liquidation</span>
            <span style={{ color: C.warning }}>
              {mc > 0 && liqEst > 0 ? fmtPx(liqEst) : '—'}
            </span>
          </KV>
        </Section>
        {needsAck && (
          <Ack
            $on={ack}
            role="checkbox"
            aria-checked={ack}
            onClick={() => setAck(a => !a)}
          >
            <i>{ack && <Check size={12} strokeWidth={3.5} color="#fff" />}</i>
            <span>
              At {lev}× a {(90 / lev).toFixed(0)}% move against you liquidates
              this position. I understand the risk.
            </span>
          </Ack>
        )}
        <Cta
          size="lg"
          block
          $tone={
            cta.ok && connected ? (dir === 'long' ? 'buy' : 'sell') : 'primary'
          }
          disabled={!cta.ok}
          onClick={cta.on}
        >
          {cta.label}
        </Cta>
      </Section>

      <Section>
        <Title>Open positions</Title>
        {positions.length === 0 ? (
          <NoPos>
            {connected
              ? 'No open margin positions.'
              : 'Connect your wallet to see your positions.'}
          </NoPos>
        ) : (
          positions.map(p => {
            const long = p.side === 'BUY'
            const pnlUp = p.unrealizedPnl >= 0
            return (
              <Pos key={p.id}>
                <PosHead>
                  <span>
                    <span style={{ color: long ? T.up : T.down }}>
                      {long ? 'Long' : 'Short'}
                    </span>{' '}
                    {p.pairSymbol} · {p.leverage}×
                  </span>
                  <div>
                    {p.isLiquidatable && (
                      <SmallBtn $danger onClick={() => settle(p, 'liquidate')}>
                        Liquidate
                      </SmallBtn>
                    )}
                    <SmallBtn onClick={() => settle(p, 'close')}>
                      Close
                    </SmallBtn>
                  </div>
                </PosHead>
                <PosGrid>
                  <span>
                    Entry / Mark{' '}
                    <b>
                      {fmtPx(p.entryPrice)} / {fmtPx(p.markPrice)}
                    </b>
                  </span>
                  <span>
                    PnL{' '}
                    <b
                      style={{ color: pnlUp ? T.up : T.down, fontWeight: 600 }}
                    >
                      {pnlUp ? '+' : ''}
                      {fmtAmt(p.unrealizedPnl)} {COLLATERAL}
                    </b>
                  </span>
                  <span>
                    Collateral <b>{fmtAmt(p.collateralAmount)}</b>
                  </span>
                  <span>
                    Liq.{' '}
                    <b style={{ color: C.warning }}>
                      {fmtPx(p.liquidationPrice)}
                    </b>
                  </span>
                </PosGrid>
              </Pos>
            )
          })
        )}
      </Section>
    </Wrap>
  )
}

export default MarginTab
