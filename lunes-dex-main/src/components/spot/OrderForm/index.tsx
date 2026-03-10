import React, { useState, useCallback, useMemo, useEffect } from 'react'
import styled, { css, keyframes } from 'styled-components'
import { useSpot } from 'context/SpotContext'
import { useSDK } from 'context/SDKContext'
import { Tooltip } from 'components/bases/tooltip'
import { contractService } from 'services/contractService'
import { calcFeeBreakdown } from 'services/spotService'
import type { FeeBreakdown } from 'services/spotService'
import MarginTab from './MarginTab'

// ──────────────────── Constants ────────────────────

const DEFAULT_MAKER_FEE = 0.001 // 0.1% fallback
const DEFAULT_TAKER_FEE = 0.0025 // 0.25% fallback
const MARKET_PRICE = 0.02345 // fallback only (replaced by live ticker)
const MIN_AMOUNT = 10
const MAX_AMOUNT = 1000000
const MIN_PRICE = 0.00001
const MAX_PRICE = 1.0

// ──────────────────── Animations ────────────────────

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
`

const slideUp = keyframes`
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
`

// ──────────────────── Styled Components ────────────────────

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
`

const Tabs = styled.div`
  display: flex;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
`

const Tab = styled.button<{ active?: boolean }>`
  flex: 1;
  padding: 10px 4px;
  font-size: 11px;
  font-weight: 600;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: all 0.15s;
  border-bottom: 2px solid ${({ active }) => (active ? '#00C076' : 'transparent')};
  color: ${({ active }) => (active ? '#ffffff' : 'rgba(255,255,255,0.4)')};
  margin-bottom: -1px;

  &:hover {
    color: rgba(255, 255, 255, 0.8);
  }
`

const Body = styled.div`
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
`

const SideTabs = styled.div`
  display: flex;
  gap: 6px;
`

const SideBtn = styled.button<{ side: 'buy' | 'sell'; active?: boolean }>`
  flex: 1;
  padding: 8px;
  border-radius: 8px;
  border: none;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;

  ${({ side, active }) => css`
    background: ${active
            ? side === 'buy' ? '#00C076' : '#FF4B55'
            : side === 'buy' ? 'rgba(0,192,118,0.1)' : 'rgba(255,75,85,0.1)'
        };
    color: ${active ? '#ffffff' : side === 'buy' ? '#00C076' : '#FF4B55'};
    border: 1px solid ${side === 'buy' ? 'rgba(0,192,118,0.3)' : 'rgba(255,75,85,0.3)'};

    &:hover {
      background: ${side === 'buy' ? '#00C076' : '#FF4B55'};
      color: #ffffff;
    }
  `}
`

const FieldLabel = styled.label`
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  margin-bottom: 2px;
  display: flex;
  align-items: center;
`

const FieldWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const Input = styled.input<{ hasError?: boolean }>`
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid ${({ hasError }) => hasError ? 'rgba(255,75,85,0.6)' : 'rgba(255, 255, 255, 0.1)'};
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  color: #ffffff;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s;

  &:focus {
    border-color: ${({ hasError }) => hasError ? '#FF4B55' : '#00C076'};
  }

  &::placeholder {
    color: rgba(255, 255, 255, 0.2);
  }
`

const InputWithSuffix = styled.div`
  position: relative;
  display: flex;
  align-items: center;

  input {
    padding-right: 52px;
  }
`

const Suffix = styled.span`
  position: absolute;
  right: 12px;
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.35);
  pointer-events: none;
`

const ErrorText = styled.span`
  font-size: 10px;
  color: #FF4B55;
  animation: ${fadeIn} 0.2s ease;
`

const Slider = styled.input`
  width: 100%;
  accent-color: #00C076;
  cursor: pointer;
`

const SliderLabels = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.3);
  margin-top: -4px;
`

const SubmitBtn = styled.button<{ side: 'buy' | 'sell'; disabled?: boolean }>`
  width: 100%;
  padding: 12px;
  border-radius: 10px;
  border: none;
  font-size: 14px;
  font-weight: 700;
  cursor: ${({ disabled }) => disabled ? 'not-allowed' : 'pointer'};
  transition: all 0.2s;
  background: ${({ side, disabled }) =>
        disabled
            ? 'rgba(255,255,255,0.08)'
            : side === 'buy' ? '#00C076' : '#FF4B55'
    };
  color: ${({ disabled }) => disabled ? 'rgba(255,255,255,0.3)' : '#ffffff'};
  letter-spacing: 0.3px;
  margin-top: auto;

  &:hover:not(:disabled) {
    opacity: 0.9;
    transform: translateY(-1px) scale(1.01);
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  }

  &:active:not(:disabled) {
    transform: translateY(1px) scale(0.98);
    box-shadow: none;
    transition: all 0.1s cubic-bezier(0.4, 0, 0.2, 1);
  }
`

const AvailableRow = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
`

const FeeRow = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  padding: 6px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
`

const FeeValue = styled.span`
  color: rgba(255, 255, 255, 0.5);
`

const SlippageWarning = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(255, 180, 0, 0.08);
  border: 1px solid rgba(255, 180, 0, 0.2);
  font-size: 11px;
  color: rgba(255, 200, 80, 0.9);
  animation: ${fadeIn} 0.25s ease;
`

const InfoBox = styled.div`
  background: rgba(0, 192, 118, 0.06);
  border: 1px solid rgba(0, 192, 118, 0.15);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  line-height: 1.5;
`

const WarningBox = styled(InfoBox)`
  background: rgba(255, 75, 85, 0.08);
  border-color: rgba(255, 75, 85, 0.2);
  color: rgba(255, 150, 155, 0.8);
`

// ──────────── Confirm Modal ────────────

const ModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: ${fadeIn} 0.2s ease;
`

const ModalCard = styled.div`
  background: #1a1a1a;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 24px;
  width: 340px;
  max-width: 90vw;
  animation: ${slideUp} 0.3s ease;
`

const ModalTitle = styled.h3`
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 700;
  color: #ffffff;
`

const ModalRow = styled.div`
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  font-size: 13px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
`

const ModalLabel = styled.span`
  color: rgba(255, 255, 255, 0.5);
`

const ModalValue = styled.span`
  color: #ffffff;
  font-weight: 600;
`

const ModalFeeRow = styled(ModalRow)`
  border-bottom: none;
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
`

const FeeSplitGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 12px;
  margin-top: 8px;
  padding: 10px 12px;
  background: rgba(255,255,255,0.03);
  border-radius: 8px;
`

const FeeSplitItem = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: rgba(255,255,255,0.35);

  span:last-child {
    color: rgba(255,255,255,0.55);
    font-weight: 600;
  }
`

const ModalActions = styled.div`
  display: flex;
  gap: 10px;
  margin-top: 20px;
`

const ModalCancelBtn = styled.button`
  flex: 1;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: rgba(255, 255, 255, 0.05);
  }
`

const ModalConfirmBtn = styled.button<{ side: 'buy' | 'sell' }>`
  flex: 2;
  padding: 10px;
  border-radius: 10px;
  border: none;
  background: ${({ side }) => side === 'buy' ? '#00C076' : '#FF4B55'};
  color: #ffffff;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    opacity: 0.9;
  }
`

// ──────────────────── Types ────────────────────

type OrderTab = 'limit' | 'market' | 'stop' | 'stop-limit' | 'margin'
type Side = 'buy' | 'sell'

interface OrderData {
    type: string
    side: Side
    price: number
    stopPrice?: number
    amount: number
    total: number
    fee: number
    feeRate: number
    feeBreakdown: FeeBreakdown
}

// ──────────────────── Confirm Modal Component ────────────────────

interface ConfirmModalProps {
    order: OrderData
    loading?: boolean
    onConfirm: () => void
    onCancel: () => void
}

const ConfirmOrderModal: React.FC<ConfirmModalProps> = ({ order, loading, onConfirm, onCancel }) => (
    <ModalOverlay onClick={onCancel}>
        <ModalCard onClick={e => e.stopPropagation()}>
            <ModalTitle>
                {order.side === 'buy' ? '▲' : '▼'} Confirm {order.type}
            </ModalTitle>

            <ModalRow>
                <ModalLabel>Type</ModalLabel>
                <ModalValue>{order.type} {order.side === 'buy' ? 'Buy' : 'Sell'}</ModalValue>
            </ModalRow>
            {order.stopPrice ? (
                <ModalRow>
                    <ModalLabel>Trigger</ModalLabel>
                    <ModalValue>{order.stopPrice.toFixed(5)} USDT</ModalValue>
                </ModalRow>
            ) : null}
            <ModalRow>
                <ModalLabel>{order.type === 'Stop' ? 'Estimate' : 'Price'}</ModalLabel>
                <ModalValue>{order.price.toFixed(5)} USDT</ModalValue>
            </ModalRow>
            <ModalRow>
                <ModalLabel>Amount</ModalLabel>
                <ModalValue>{order.amount.toLocaleString()} LUNES</ModalValue>
            </ModalRow>
            <ModalRow>
                <ModalLabel>Total</ModalLabel>
                <ModalValue>{order.total.toFixed(2)} USDT</ModalValue>
            </ModalRow>
            <ModalFeeRow>
                <ModalLabel>Fee ({(order.feeRate * 100).toFixed(2)}%)</ModalLabel>
                <ModalValue style={{ color: 'rgba(255,255,255,0.5)' }}>
                    ~{order.fee.toFixed(4)} USDT
                </ModalValue>
            </ModalFeeRow>
            {order.fee > 0 && (
                <FeeSplitGrid>
                    <FeeSplitItem><span>Team</span><span>{order.feeBreakdown.team.toFixed(4)}</span></FeeSplitItem>
                    <FeeSplitItem><span>Stakers</span><span>{order.feeBreakdown.stakers.toFixed(4)}</span></FeeSplitItem>
                    <FeeSplitItem><span>Affiliates</span><span>{order.feeBreakdown.affiliates.toFixed(4)}</span></FeeSplitItem>
                    {order.feeBreakdown.treasury > 0 && (
                        <FeeSplitItem><span>Treasury</span><span>{order.feeBreakdown.treasury.toFixed(4)}</span></FeeSplitItem>
                    )}
                </FeeSplitGrid>
            )}

            <ModalActions>
                <ModalCancelBtn onClick={onCancel} disabled={loading}>Cancel</ModalCancelBtn>
                <ModalConfirmBtn side={order.side} onClick={onConfirm} disabled={loading}>
                    {loading ? 'Processing...' : order.side === 'buy' ? '▲ Confirm Buy' : '▼ Confirm Sell'}
                </ModalConfirmBtn>
            </ModalActions>
        </ModalCard>
    </ModalOverlay>
)

// ──────────────────── Sub-forms ────────────────────

interface FormProps {
    side: Side
    onSubmit: (order: OrderData) => void
    balanceUsdt?: number
    balanceLunes?: number
    marketPrice?: number
    makerFee?: number
    takerFee?: number
}

const MarketForm: React.FC<FormProps> = ({ side, onSubmit, balanceUsdt = 0, balanceLunes = 0, marketPrice = MARKET_PRICE, makerFee = DEFAULT_MAKER_FEE, takerFee = DEFAULT_TAKER_FEE }) => {
    const [amount, setAmount] = useState('')
    const [sliderVal, setSliderVal] = useState(0)
    const numAmount = parseFloat(amount) || 0
    const total = numAmount * marketPrice
    const fee = total * takerFee

    const amountError = useMemo(() => {
        if (!amount) return ''
        if (numAmount < MIN_AMOUNT) return `Min: ${MIN_AMOUNT} LUNES`
        if (numAmount > MAX_AMOUNT) return `Max: ${MAX_AMOUNT.toLocaleString()} LUNES`
        if (side === 'buy' && total > balanceUsdt) return 'Insufficient balance'
        if (side === 'sell' && numAmount > balanceLunes) return 'Insufficient balance'
        return ''
    }, [amount, numAmount, total, side, balanceUsdt, balanceLunes])

    const isValid = numAmount >= MIN_AMOUNT && !amountError

    const handleSlider = (pct: number) => {
        setSliderVal(pct)
        const maxAmount = side === 'buy'
            ? Math.floor(balanceUsdt / marketPrice)
            : balanceLunes
        setAmount(String(Math.floor(maxAmount * pct / 100)))
    }

    const handleSubmit = () => {
        if (!isValid) return
        onSubmit({
            type: 'Market',
            side,
            price: marketPrice,
            amount: numAmount,
            total,
            fee,
            feeRate: takerFee,
            feeBreakdown: calcFeeBreakdown(fee, false),
        })
    }

    return (
        <>
            <SlippageWarning>
                ℹ️ Market order — price may vary (slippage ~0.1-0.5%)
            </SlippageWarning>
            <FieldWrapper>
                <FieldLabel>Amount (LUNES)</FieldLabel>
                <InputWithSuffix>
                    <Input
                        type="number"
                        placeholder="0.00"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                        hasError={!!amountError}
                        min={MIN_AMOUNT}
                        step={1}
                    />
                    <Suffix>LUNES</Suffix>
                </InputWithSuffix>
                {amountError && <ErrorText>{amountError}</ErrorText>}
            </FieldWrapper>
            <Slider
                type="range"
                min={0}
                max={100}
                value={sliderVal}
                onChange={e => handleSlider(Number(e.target.value))}
            />
            <SliderLabels>
                <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
            </SliderLabels>
            <FieldWrapper>
                <FieldLabel>Total (USDT)</FieldLabel>
                <InputWithSuffix>
                    <Input type="text" value={total > 0 ? total.toFixed(2) : ''} placeholder="0.00" readOnly />
                    <Suffix>USDT</Suffix>
                </InputWithSuffix>
            </FieldWrapper>
            <AvailableRow>
                <span>Available</span>
                <span>{side === 'buy' ? `${balanceUsdt.toFixed(2)} USDT` : `${balanceLunes.toLocaleString()} LUNES`}</span>
            </AvailableRow>
            {numAmount > 0 && (
                <FeeRow>
                    <span>
                        Fee (Taker {(takerFee * 100).toFixed(2)}%)
                        <Tooltip content={`Market execution fee (${(takerFee * 100).toFixed(2)}%). Deducted from total received.`} />
                    </span>
                    <FeeValue>~{fee.toFixed(4)} USDT</FeeValue>
                </FeeRow>
            )}
            <SubmitBtn side={side} disabled={!isValid} onClick={handleSubmit}>
                {side === 'buy' ? '▲ Buy LUNES (Market)' : '▼ Sell LUNES (Market)'}
            </SubmitBtn>
        </>
    )
}

const LimitForm: React.FC<FormProps> = ({ side, onSubmit, balanceUsdt = 0, balanceLunes = 0, marketPrice = MARKET_PRICE, makerFee = DEFAULT_MAKER_FEE, takerFee = DEFAULT_TAKER_FEE }) => {
    const [price, setPrice] = useState('')
    const [amount, setAmount] = useState('')
    const [sliderVal, setSliderVal] = useState(0)
    const numPrice = parseFloat(price) || 0
    const numAmount = parseFloat(amount) || 0
    const total = numPrice * numAmount
    const fee = total * makerFee

    const priceError = useMemo(() => {
        if (!price) return ''
        if (numPrice < MIN_PRICE) return `Min: ${MIN_PRICE}`
        if (numPrice > MAX_PRICE) return `Max: ${MAX_PRICE}`
        return ''
    }, [price, numPrice])

    const amountError = useMemo(() => {
        if (!amount) return ''
        if (numAmount < MIN_AMOUNT) return `Min: ${MIN_AMOUNT} LUNES`
        if (numAmount > MAX_AMOUNT) return `Max: ${MAX_AMOUNT.toLocaleString()} LUNES`
        if (side === 'buy' && total > balanceUsdt) return 'Insufficient balance'
        if (side === 'sell' && numAmount > balanceLunes) return 'Insufficient balance'
        return ''
    }, [amount, numAmount, total, side, balanceUsdt, balanceLunes])

    const isValid = numPrice >= MIN_PRICE && numAmount >= MIN_AMOUNT && !priceError && !amountError

    const handleSlider = (pct: number) => {
        setSliderVal(pct)
        const effectivePrice = numPrice || marketPrice
        const maxAmount = side === 'buy'
            ? Math.floor(balanceUsdt / effectivePrice)
            : balanceLunes
        setAmount(String(Math.floor(maxAmount * pct / 100)))
    }

    const handleSubmit = () => {
        if (!isValid) return
        onSubmit({
            type: 'Limit',
            side,
            price: numPrice,
            amount: numAmount,
            total,
            fee,
            feeRate: makerFee,
            feeBreakdown: calcFeeBreakdown(fee, true),
        })
    }

    return (
        <>
            <FieldWrapper>
                <FieldLabel>Price (USDT)</FieldLabel>
                <InputWithSuffix>
                    <Input
                        type="number"
                        placeholder="0.00000"
                        value={price}
                        onChange={e => setPrice(e.target.value)}
                        hasError={!!priceError}
                        step={0.00001}
                        min={MIN_PRICE}
                    />
                    <Suffix>USDT</Suffix>
                </InputWithSuffix>
                {priceError && <ErrorText>{priceError}</ErrorText>}
            </FieldWrapper>
            <FieldWrapper>
                <FieldLabel>Amount (LUNES)</FieldLabel>
                <InputWithSuffix>
                    <Input
                        type="number"
                        placeholder="0.00"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                        hasError={!!amountError}
                        min={MIN_AMOUNT}
                        step={1}
                    />
                    <Suffix>LUNES</Suffix>
                </InputWithSuffix>
                {amountError && <ErrorText>{amountError}</ErrorText>}
            </FieldWrapper>
            <Slider
                type="range"
                min={0}
                max={100}
                value={sliderVal}
                onChange={e => handleSlider(Number(e.target.value))}
            />
            <SliderLabels>
                <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
            </SliderLabels>
            <FieldWrapper>
                <FieldLabel>Total (USDT)</FieldLabel>
                <InputWithSuffix>
                    <Input type="text" value={total > 0 ? total.toFixed(2) : ''} placeholder="0.00" readOnly />
                    <Suffix>USDT</Suffix>
                </InputWithSuffix>
            </FieldWrapper>
            <AvailableRow>
                <span>Available</span>
                <span>{side === 'buy' ? `${balanceUsdt.toFixed(2)} USDT` : `${balanceLunes.toLocaleString()} LUNES`}</span>
            </AvailableRow>
            {total > 0 && (
                <FeeRow>
                    <span>
                        Fee (Maker {(makerFee * 100).toFixed(2)}%)
                        <Tooltip content={`Limit orders pay a lower Maker fee (${(makerFee * 100).toFixed(2)}%) as they add liquidity to the book.`} position="top" />
                    </span>
                    <FeeValue>~{fee.toFixed(4)} USDT</FeeValue>
                </FeeRow>
            )}
            <SubmitBtn side={side} disabled={!isValid} onClick={handleSubmit}>
                {side === 'buy' ? '▲ Buy LUNES (Limit)' : '▼ Sell LUNES (Limit)'}
            </SubmitBtn>
        </>
    )
}

const StopForm: React.FC<FormProps> = ({ side, onSubmit, balanceUsdt = 0, balanceLunes = 0, marketPrice = MARKET_PRICE, makerFee = DEFAULT_MAKER_FEE, takerFee = DEFAULT_TAKER_FEE }) => {
    const [stopPrice, setStopPrice] = useState('')
    const [amount, setAmount] = useState('')
    const numStop = parseFloat(stopPrice) || 0
    const numAmount = parseFloat(amount) || 0
    const total = numStop * numAmount
    const fee = total * takerFee

    const isValid = numStop >= MIN_PRICE && numAmount >= MIN_AMOUNT

    const handleSubmit = () => {
        if (!isValid) return
        onSubmit({
            type: 'Stop',
            side,
            price: marketPrice,
            stopPrice: numStop,
            amount: numAmount,
            total,
            fee,
            feeRate: takerFee,
            feeBreakdown: calcFeeBreakdown(fee, false),
        })
    }

    return (
        <>
            <InfoBox>
                ℹ️ When the market reaches the <strong>Stop Price</strong>, a market order will be executed.
            </InfoBox>
            <FieldWrapper>
                <FieldLabel>
                    Stop Price (USDT)
                    <Tooltip content="The trigger price to activate your market order." position="right" />
                </FieldLabel>
                <InputWithSuffix>
                    <Input
                        type="number"
                        placeholder="0.00000"
                        value={stopPrice}
                        onChange={e => setStopPrice(e.target.value)}
                        step={0.00001}
                        min={MIN_PRICE}
                    />
                    <Suffix>USDT</Suffix>
                </InputWithSuffix>
            </FieldWrapper>
            <FieldWrapper>
                <FieldLabel>Amount (LUNES)</FieldLabel>
                <InputWithSuffix>
                    <Input
                        type="number"
                        placeholder="0.00"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                        min={MIN_AMOUNT}
                        step={1}
                    />
                    <Suffix>LUNES</Suffix>
                </InputWithSuffix>
            </FieldWrapper>
            <AvailableRow>
                <span>Available</span>
                <span>{side === 'buy' ? `${balanceUsdt.toFixed(2)} USDT` : `${balanceLunes.toLocaleString()} LUNES`}</span>
            </AvailableRow>
            {total > 0 && (
                <FeeRow>
                    <span>Fee (Taker {(takerFee * 100).toFixed(2)}%)</span>
                    <FeeValue>~{fee.toFixed(4)} USDT</FeeValue>
                </FeeRow>
            )}
            <SubmitBtn side={side} disabled={!isValid} onClick={handleSubmit}>
                {side === 'buy' ? '▲ Stop Buy' : '▼ Stop Sell'}
            </SubmitBtn>
        </>
    )
}

const StopLimitForm: React.FC<FormProps> = ({ side, onSubmit, balanceUsdt = 0, balanceLunes = 0, makerFee = DEFAULT_MAKER_FEE, takerFee = DEFAULT_TAKER_FEE }) => {
    const [stopPrice, setStopPrice] = useState('')
    const [limitPrice, setLimitPrice] = useState('')
    const [amount, setAmount] = useState('')
    const numStop = parseFloat(stopPrice) || 0
    const numLimit = parseFloat(limitPrice) || 0
    const numAmount = parseFloat(amount) || 0
    const total = numLimit * numAmount
    const fee = total * makerFee

    const isValid = numStop >= MIN_PRICE && numLimit >= MIN_PRICE && numAmount >= MIN_AMOUNT

    const handleSubmit = () => {
        if (!isValid) return
        onSubmit({
            type: 'Stop-Limit',
            side,
            price: numLimit,
            stopPrice: numStop,
            amount: numAmount,
            total,
            fee,
            feeRate: makerFee,
            feeBreakdown: calcFeeBreakdown(fee, true),
        })
    }

    return (
        <>
            <InfoBox>
                ℹ️ When the <strong>Stop Price</strong> is reached, a Limit order at the <strong>Limit Price</strong> will be placed.
            </InfoBox>
            <FieldWrapper>
                <FieldLabel>
                    Stop Price (USDT)
                    <Tooltip content="The trigger price to submit your Limit order to the book." position="right" />
                </FieldLabel>
                <InputWithSuffix>
                    <Input
                        type="number"
                        placeholder="0.00000"
                        value={stopPrice}
                        onChange={e => setStopPrice(e.target.value)}
                        step={0.00001}
                    />
                    <Suffix>USDT</Suffix>
                </InputWithSuffix>
            </FieldWrapper>
            <FieldWrapper>
                <FieldLabel>Limit Price (USDT)</FieldLabel>
                <InputWithSuffix>
                    <Input
                        type="number"
                        placeholder="0.00000"
                        value={limitPrice}
                        onChange={e => setLimitPrice(e.target.value)}
                        step={0.00001}
                    />
                    <Suffix>USDT</Suffix>
                </InputWithSuffix>
            </FieldWrapper>
            <FieldWrapper>
                <FieldLabel>Amount (LUNES)</FieldLabel>
                <InputWithSuffix>
                    <Input
                        type="number"
                        placeholder="0.00"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                        min={MIN_AMOUNT}
                        step={1}
                    />
                    <Suffix>LUNES</Suffix>
                </InputWithSuffix>
            </FieldWrapper>
            <AvailableRow>
                <span>Available</span>
                <span>{side === 'buy' ? `${balanceUsdt.toFixed(2)} USDT` : `${balanceLunes.toLocaleString()} LUNES`}</span>
            </AvailableRow>
            {total > 0 && (
                <FeeRow>
                    <span>Fee (Maker {(makerFee * 100).toFixed(2)}%)</span>
                    <FeeValue>~{fee.toFixed(4)} USDT</FeeValue>
                </FeeRow>
            )}
            <SubmitBtn side={side} disabled={!isValid} onClick={handleSubmit}>
                {side === 'buy' ? '▲ Stop-Limit Buy' : '▼ Stop-Limit Sell'}
            </SubmitBtn>
        </>
    )
}

// ──────────────────── Main Component ────────────────────

const ORDER_TABS: Array<{ key: OrderTab; label: string }> = [
    { key: 'limit', label: 'Limit' },
    { key: 'market', label: 'Market' },
    { key: 'stop', label: 'Stop' },
    { key: 'stop-limit', label: 'Stop-Limit' },
    { key: 'margin', label: 'Margin' },
]

const LUSDT_ADDRESS = process.env.REACT_APP_TOKEN_LUSDT || '5CdLQGeA89rffQrfckqB8cX3qQkMauszo7rqt5QaNYChsXsf'

const OrderForm: React.FC = () => {
    const { selectedPair, pairs, ticker, createOrder, isLoading, error, walletAddress } = useSpot()
    const { walletAddress: sdkWalletAddress, connectWallet, signMessage } = useSDK()
    const [activeTab, setActiveTab] = useState<OrderTab>('limit')
    const [side, setSide] = useState<Side>('buy')
    const [pendingOrder, setPendingOrder] = useState<OrderData | null>(null)
    const [submitStatus, setSubmitStatus] = useState<string | null>(null)
    const [balanceUsdt, setBalanceUsdt] = useState(0)
    const [balanceLunes, setBalanceLunes] = useState(0)

    // Fetch real balances when wallet connects
    useEffect(() => {
        if (!sdkWalletAddress) {
            setBalanceUsdt(0)
            setBalanceLunes(0)
            return
        }
        Promise.all([
            contractService.getTokenBalance(LUSDT_ADDRESS, sdkWalletAddress).catch(() => '0'),
            contractService.getNativeBalance(sdkWalletAddress).catch(() => '0'),
        ]).then(([lusdtRaw, lunesRaw]) => {
            setBalanceUsdt(Number(lusdtRaw) / 1e6) // LUSDT: 6 decimals
            setBalanceLunes(Number(lunesRaw) / 1e8) // LUNES: 8 decimals
        })
    }, [sdkWalletAddress])

    const handleSubmit = useCallback((order: OrderData) => {
        setPendingOrder(order)
    }, [])

    const handleConfirm = useCallback(async () => {
        if (!pendingOrder) return
        setSubmitStatus(null)

        if (!sdkWalletAddress) {
            await connectWallet()
            return
        }

        const typeMap: Record<string, 'LIMIT' | 'MARKET' | 'STOP' | 'STOP_LIMIT'> = {
            Limit: 'LIMIT',
            Market: 'MARKET',
            Stop: 'STOP',
            'Stop-Limit': 'STOP_LIMIT',
        }
        const orderType = typeMap[pendingOrder.type] || 'LIMIT'
        const orderPrice = orderType === 'LIMIT' || orderType === 'STOP_LIMIT'
            ? pendingOrder.price.toString()
            : undefined
        const orderStopPrice = orderType === 'STOP' || orderType === 'STOP_LIMIT'
            ? pendingOrder.stopPrice?.toString()
            : undefined

        const success = await createOrder({
            pairSymbol: selectedPair,
            side: pendingOrder.side === 'buy' ? 'BUY' : 'SELL',
            type: orderType,
            price: orderPrice,
            stopPrice: orderStopPrice,
            amount: pendingOrder.amount.toString(),
            signMessage,
        })

        if (success) {
            setSubmitStatus(
                orderType === 'STOP' || orderType === 'STOP_LIMIT'
                    ? 'Order armed successfully. It will trigger when the market reaches your stop price.'
                    : 'Order submitted successfully!'
            )
        }
        setPendingOrder(null)
    }, [pendingOrder, sdkWalletAddress, connectWallet, createOrder, selectedPair, signMessage])

    const handleCancel = useCallback(() => {
        setPendingOrder(null)
    }, [])

    const liveMarketPrice = ticker?.lastPrice ?? MARKET_PRICE
    const activePair = pairs.find(p => p.symbol === selectedPair)
    const makerFee = activePair ? activePair.makerFeeBps / 10000 : DEFAULT_MAKER_FEE
    const takerFee = activePair ? activePair.takerFeeBps / 10000 : DEFAULT_TAKER_FEE
    const formProps = { side, onSubmit: handleSubmit, balanceUsdt, balanceLunes, marketPrice: liveMarketPrice, makerFee, takerFee }

    const renderForm = () => {
        switch (activeTab) {
            case 'market': return <MarketForm {...formProps} />
            case 'stop': return <StopForm {...formProps} />
            case 'stop-limit': return <StopLimitForm {...formProps} />
            case 'margin': return (
                <MarginTab
                    side={side}
                    selectedPair={selectedPair}
                    walletAddress={sdkWalletAddress}
                    signMessage={signMessage}
                    connectWallet={connectWallet}
                />
            )
            default: return <LimitForm {...formProps} />
        }
    }

    return (
        <Wrapper>
            <Tabs>
                {ORDER_TABS.map(t => (
                    <Tab key={t.key} active={activeTab === t.key} onClick={() => setActiveTab(t.key)}>
                        {t.label}
                    </Tab>
                ))}
            </Tabs>

            <Body>
                <SideTabs>
                    <SideBtn side="buy" active={side === 'buy'} onClick={() => setSide('buy')}>
                        Buy
                    </SideBtn>
                    <SideBtn side="sell" active={side === 'sell'} onClick={() => setSide('sell')}>
                        Sell
                    </SideBtn>
                </SideTabs>

                {submitStatus ? <InfoBox>{submitStatus}</InfoBox> : null}
                {error ? <WarningBox>{error}</WarningBox> : null}
                {!walletAddress ? <WarningBox>Connect your wallet to sign and submit Spot orders.</WarningBox> : null}

                {renderForm()}
            </Body>

            {pendingOrder && (
                <ConfirmOrderModal
                    order={pendingOrder}
                    loading={isLoading}
                    onConfirm={handleConfirm}
                    onCancel={handleCancel}
                />
            )}
        </Wrapper>
    )
}

export default OrderForm
