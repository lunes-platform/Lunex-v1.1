import React, { useCallback, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { marginApi, MarginOverview, MarginPositionOverview } from 'services/marginService'
import {
  buildMarginClosePositionSignMessage,
  buildMarginCollateralSignMessage,
  buildMarginLiquidatePositionSignMessage,
  buildMarginOpenPositionSignMessage,
  createSignedActionMetadata,
} from '../../../utils/signing'

interface MarginTabProps {
  side: 'buy' | 'sell'
  selectedPair: string
  walletAddress: string | null
  signMessage: (message: string) => Promise<string>
  connectWallet: () => Promise<void>
}

const Panel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
`

const Card = styled.div`
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const Label = styled.span`
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
  text-transform: uppercase;
`

const Value = styled.span`
  font-size: 14px;
  font-weight: 700;
  color: #ffffff;
`

const Box = styled.div<{ tone?: 'info' | 'warn' }>`
  background: ${({ tone }) => tone === 'warn' ? 'rgba(255, 75, 85, 0.08)' : 'rgba(0, 192, 118, 0.06)'};
  border: 1px solid ${({ tone }) => tone === 'warn' ? 'rgba(255, 75, 85, 0.2)' : 'rgba(0, 192, 118, 0.15)'};
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 11px;
  color: ${({ tone }) => tone === 'warn' ? 'rgba(255, 150, 155, 0.88)' : 'rgba(255, 255, 255, 0.68)'};
  line-height: 1.5;
`

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const SectionTitle = styled.div`
  font-size: 12px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.82);
`

const Row = styled.div`
  display: flex;
  gap: 8px;
`

const Field = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const FieldLabel = styled.label`
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
`

const Input = styled.input`
  width: 100%;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  color: #ffffff;
  outline: none;

  &:focus {
    border-color: #00C076;
  }

  &::placeholder {
    color: rgba(255, 255, 255, 0.2);
  }
`

const ActionButton = styled.button<{ tone?: 'buy' | 'sell' | 'neutral' }>`
  flex: 1;
  border: none;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  color: #ffffff;
  background: ${({ tone }) =>
    tone === 'sell' ? '#FF4B55' : tone === 'neutral' ? 'rgba(255,255,255,0.12)' : '#00C076'};
  opacity: ${({ disabled }) => disabled ? 0.5 : 1};

  &:disabled {
    cursor: not-allowed;
  }
`

const PositionCard = styled.div`
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const PositionHeader = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
`

const PositionTitle = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: #ffffff;
`

const Badge = styled.span<{ tone?: 'good' | 'bad' | 'neutral' }>`
  padding: 3px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  color: ${({ tone }) => tone === 'bad' ? '#FFB7BB' : tone === 'good' ? '#8EF0BF' : 'rgba(255,255,255,0.7)'};
  background: ${({ tone }) => tone === 'bad' ? 'rgba(255,75,85,0.18)' : tone === 'good' ? 'rgba(0,192,118,0.18)' : 'rgba(255,255,255,0.1)'};
`

const PositionGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
`

const PositionMetric = styled.div`
  display: flex;
  flex-direction: column;
  gap: 3px;
`

function formatNumber(value: number, digits = 4) {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '0'
}

function formatPnl(value: number) {
  const formatted = formatNumber(Math.abs(value), 4)
  return value >= 0 ? `+${formatted}` : `-${formatted}`
}

export const MarginTab: React.FC<MarginTabProps> = ({
  side,
  selectedPair,
  walletAddress,
  signMessage,
  connectWallet,
}) => {
  const [overview, setOverview] = useState<MarginOverview | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [depositAmount, setDepositAmount] = useState('100')
  const [withdrawAmount, setWithdrawAmount] = useState('50')
  const [collateralAmount, setCollateralAmount] = useState('100')
  const [leverage, setLeverage] = useState('3')

  const loadOverview = useCallback(async () => {
    if (!walletAddress) {
      setOverview(null)
      return
    }

    const nextOverview = await marginApi.getOverview(walletAddress)
    setOverview(nextOverview)
  }, [walletAddress])

  useEffect(() => {
    loadOverview().catch((err: Error) => {
      setError(err.message)
    })
  }, [loadOverview])

  const withWallet = useCallback(async () => {
    if (walletAddress) return walletAddress
    await connectWallet()
    return null
  }, [walletAddress, connectWallet])

  const submitAction = useCallback(async (action: () => Promise<void>) => {
    setIsLoading(true)
    setError(null)
    setSuccess(null)
    try {
      await action()
    } catch (err: any) {
      setError(err.message || 'Margin action failed')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleDeposit = useCallback(async () => {
    await submitAction(async () => {
      const address = await withWallet()
      if (!address) return
      const signedAction = createSignedActionMetadata()
      const signature = await signMessage(buildMarginCollateralSignMessage({
        address,
        action: 'deposit',
        token: 'USDT',
        amount: depositAmount,
        nonce: signedAction.nonce,
        timestamp: signedAction.timestamp,
      }))
      await marginApi.depositCollateral({
        address,
        token: 'USDT',
        amount: depositAmount,
        nonce: signedAction.nonce,
        timestamp: signedAction.timestamp,
        signature,
      })
      await loadOverview()
      setSuccess('Collateral deposited successfully.')
    })
  }, [depositAmount, loadOverview, signMessage, submitAction, withWallet])

  const handleWithdraw = useCallback(async () => {
    await submitAction(async () => {
      const address = await withWallet()
      if (!address) return
      const signedAction = createSignedActionMetadata()
      const signature = await signMessage(buildMarginCollateralSignMessage({
        address,
        action: 'withdraw',
        token: 'USDT',
        amount: withdrawAmount,
        nonce: signedAction.nonce,
        timestamp: signedAction.timestamp,
      }))
      await marginApi.withdrawCollateral({
        address,
        token: 'USDT',
        amount: withdrawAmount,
        nonce: signedAction.nonce,
        timestamp: signedAction.timestamp,
        signature,
      })
      await loadOverview()
      setSuccess('Collateral withdrawn successfully.')
    })
  }, [loadOverview, signMessage, submitAction, withdrawAmount, withWallet])

  const handleOpenPosition = useCallback(async () => {
    await submitAction(async () => {
      const address = await withWallet()
      if (!address) return
      const orderSide = side === 'buy' ? 'BUY' : 'SELL'
      const signedAction = createSignedActionMetadata()
      const signature = await signMessage(buildMarginOpenPositionSignMessage({
        address,
        pairSymbol: selectedPair,
        side: orderSide,
        collateralAmount,
        leverage,
        nonce: signedAction.nonce,
        timestamp: signedAction.timestamp,
      }))
      await marginApi.openPosition({
        address,
        pairSymbol: selectedPair,
        side: orderSide,
        collateralAmount,
        leverage,
        nonce: signedAction.nonce,
        timestamp: signedAction.timestamp,
        signature,
      })
      await loadOverview()
      setSuccess('Margin position opened successfully.')
    })
  }, [collateralAmount, leverage, loadOverview, selectedPair, side, signMessage, submitAction, withWallet])

  const handleClose = useCallback(async (position: MarginPositionOverview) => {
    await submitAction(async () => {
      const address = await withWallet()
      if (!address) return
      const signedAction = createSignedActionMetadata()
      const signature = await signMessage(buildMarginClosePositionSignMessage({
        address,
        positionId: position.id,
        nonce: signedAction.nonce,
        timestamp: signedAction.timestamp,
      }))
      await marginApi.closePosition({
        positionId: position.id,
        address,
        nonce: signedAction.nonce,
        timestamp: signedAction.timestamp,
        signature,
      })
      await loadOverview()
      setSuccess('Position closed successfully.')
    })
  }, [loadOverview, signMessage, submitAction, withWallet])

  const handleLiquidate = useCallback(async (position: MarginPositionOverview) => {
    await submitAction(async () => {
      const address = await withWallet()
      if (!address) return
      const signedAction = createSignedActionMetadata()
      const signature = await signMessage(buildMarginLiquidatePositionSignMessage({
        address,
        positionId: position.id,
        nonce: signedAction.nonce,
        timestamp: signedAction.timestamp,
      }))
      await marginApi.liquidatePosition({
        positionId: position.id,
        liquidatorAddress: address,
        nonce: signedAction.nonce,
        timestamp: signedAction.timestamp,
        signature,
      })
      await loadOverview()
      setSuccess('Position liquidated successfully.')
    })
  }, [loadOverview, signMessage, submitAction, withWallet])

  const liquidatableCount = useMemo(() => overview?.risk.liquidatablePositions || 0, [overview])

  return (
    <Panel>
      <Box>
        Margin now uses a real backend flow for collateral, positions and liquidation. The current implementation is isolated margin backed by the spot-api risk engine.
      </Box>

      {error ? <Box tone="warn">{error}</Box> : null}
      {success ? <Box>{success}</Box> : null}
      {!walletAddress ? <Box tone="warn">Connect your wallet to manage margin collateral and positions.</Box> : null}

      <Grid>
        <Card>
          <Label>Available Collateral</Label>
          <Value>{formatNumber(overview?.account.collateralAvailable || 0, 2)} USDT</Value>
        </Card>
        <Card>
          <Label>Locked Collateral</Label>
          <Value>{formatNumber(overview?.account.collateralLocked || 0, 2)} USDT</Value>
        </Card>
        <Card>
          <Label>Total Equity</Label>
          <Value>{formatNumber(overview?.account.totalEquity || 0, 2)} USDT</Value>
        </Card>
        <Card>
          <Label>Liquidatable Positions</Label>
          <Value>{liquidatableCount}</Value>
        </Card>
        <Card>
          <Label>Mark Price Source</Label>
          <Value>{overview?.risk.markPriceHealth?.sources?.join(' / ') || 'N/A'}</Value>
        </Card>
        <Card>
          <Label>Max Mark Age</Label>
          <Value>{overview?.risk.markPriceHealth ? `${Math.round(overview.risk.markPriceHealth.maxAgeMs / 1000)}s` : 'N/A'}</Value>
        </Card>
      </Grid>

      <Section>
        <SectionTitle>Collateral</SectionTitle>
        <Row>
          <Field>
            <FieldLabel>Deposit</FieldLabel>
            <Input value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} placeholder="100" type="number" />
          </Field>
          <Field>
            <FieldLabel>Withdraw</FieldLabel>
            <Input value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} placeholder="50" type="number" />
          </Field>
        </Row>
        <Row>
          <ActionButton onClick={handleDeposit} disabled={isLoading} tone="buy">Deposit USDT</ActionButton>
          <ActionButton onClick={handleWithdraw} disabled={isLoading} tone="neutral">Withdraw USDT</ActionButton>
        </Row>
      </Section>

      <Section>
        <SectionTitle>Open Margin Position</SectionTitle>
        <Row>
          <Field>
            <FieldLabel>Pair</FieldLabel>
            <Input value={selectedPair} readOnly />
          </Field>
          <Field>
            <FieldLabel>Direction</FieldLabel>
            <Input value={side === 'buy' ? 'Long' : 'Short'} readOnly />
          </Field>
        </Row>
        <Row>
          <Field>
            <FieldLabel>Collateral (USDT)</FieldLabel>
            <Input value={collateralAmount} onChange={(event) => setCollateralAmount(event.target.value)} type="number" placeholder="100" />
          </Field>
          <Field>
            <FieldLabel>Leverage</FieldLabel>
            <Input value={leverage} onChange={(event) => setLeverage(event.target.value)} type="number" min="1" max="7.9" step="0.1" placeholder="3" />
          </Field>
        </Row>
        <ActionButton onClick={handleOpenPosition} disabled={isLoading} tone={side === 'buy' ? 'buy' : 'sell'}>
          {side === 'buy' ? 'Open Long' : 'Open Short'}
        </ActionButton>
      </Section>

      <Section>
        <SectionTitle>Open Positions</SectionTitle>
        {overview?.positions.length ? overview.positions.map((position) => (
          <PositionCard key={position.id}>
            <PositionHeader>
              <PositionTitle>{position.pairSymbol} {position.side === 'BUY' ? 'Long' : 'Short'}</PositionTitle>
              <Badge tone={position.isLiquidatable ? 'bad' : position.unrealizedPnl >= 0 ? 'good' : 'neutral'}>
                {position.status}
              </Badge>
            </PositionHeader>
            <PositionGrid>
              <PositionMetric>
                <Label>Entry / Mark</Label>
                <Value>{formatNumber(position.entryPrice, 5)} / {formatNumber(position.markPrice, 5)}</Value>
              </PositionMetric>
              <PositionMetric>
                <Label>Collateral / Leverage</Label>
                <Value>{formatNumber(position.collateralAmount, 2)} / {formatNumber(position.leverage, 2)}x</Value>
              </PositionMetric>
              <PositionMetric>
                <Label>Equity / Health</Label>
                <Value>{formatNumber(position.equity, 2)} / {position.healthFactor ? formatNumber(position.healthFactor, 2) : '∞'}</Value>
              </PositionMetric>
              <PositionMetric>
                <Label>PnL / Liquidation</Label>
                <Value>{formatPnl(position.unrealizedPnl)} / {formatNumber(position.liquidationPrice, 5)}</Value>
              </PositionMetric>
              <PositionMetric>
                <Label>Mark Source / Age</Label>
                <Value>{position.markPriceMeta ? `${position.markPriceMeta.source} / ${Math.round(position.markPriceMeta.ageMs / 1000)}s` : 'N/A'}</Value>
              </PositionMetric>
            </PositionGrid>
            <Row>
              <ActionButton onClick={async () => { await handleClose(position) }} disabled={isLoading || position.status !== 'OPEN'} tone="neutral">Close</ActionButton>
              <ActionButton onClick={async () => { await handleLiquidate(position) }} disabled={isLoading || !position.isLiquidatable || position.status !== 'OPEN'} tone="sell">Liquidate</ActionButton>
            </Row>
          </PositionCard>
        )) : <Box>No margin positions yet. Deposit collateral and open your first isolated position.</Box>}
      </Section>
    </Panel>
  )
}

export default MarginTab
