/**
 * Review swap — pay / receive cards, quote details, the "at least X or it
 * reverts" copy, a required risk acknowledgement when price impact > 5% or
 * slippage > 3%, and Confirm.
 */
import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { Check } from 'lucide-react'
import { Dialog } from 'components/ui/Dialog'
import { Button, C, EASE_OUT, grotesk, tabular } from 'components/ui/kit'
import { TokenImg, Token } from 'components/TokenSelect'
import { drawStroke, riseIn } from 'styles/motion'
import { DetailRow } from '../../details'

const Cards = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const AmountCard = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border-radius: 14px;
  background: ${C.bg};
  > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  small {
    font-size: 12px;
    color: ${C.muted};
  }
  strong {
    ${grotesk};
    ${tabular};
    font-size: 24px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const Rows = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const Line = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 0;
  font-size: 13px;
  > span:first-child {
    color: ${C.muted};
  }
  > span:last-child {
    font-weight: 500;
    text-align: right;
    ${tabular};
  }
`

const Risk = styled.button`
  display: flex;
  gap: 10px;
  align-items: flex-start;
  text-align: left;
  width: 100%;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 93, 105, 0.45);
  background: rgba(255, 40, 76, 0.08);
  color: #fff;
  font-size: 13px;
  line-height: 1.45;
  animation: ${riseIn} 200ms ${EASE_OUT} both;
`

const Box = styled.span<{ $on: boolean }>`
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
  svg path,
  svg polyline {
    stroke-dasharray: 24;
    animation: ${drawStroke} 250ms ease both;
  }
`

const Fine = styled.p`
  font-size: 12px;
  line-height: 1.5;
  color: ${C.muted};
  strong {
    color: #fff;
    font-weight: 600;
  }
`

type Props = {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  from: Token
  to: Token
  payLabel: string
  receiveLabel: string
  usdIn: string
  usdOut: string
  rows: DetailRow[]
  minOutLabel: string
  /** null → no risk acknowledgement needed. */
  riskText: string | null
  danger: boolean
  /** null while the allowance is being checked. */
  needsApproval: boolean | null
}

const ReviewSwap: React.FC<Props> = ({
  open,
  onClose,
  onConfirm,
  from,
  to,
  payLabel,
  receiveLabel,
  usdIn,
  usdOut,
  rows,
  minOutLabel,
  riskText,
  danger,
  needsApproval
}) => {
  const [ack, setAck] = useState(false)
  useEffect(() => {
    if (open) setAck(false)
  }, [open])
  const blocked = !!riskText && !ack

  return (
    <Dialog open={open} onClose={onClose} title="Review swap" width={440}>
      <Cards>
        <AmountCard>
          <div>
            <small>You pay</small>
            <strong>{payLabel}</strong>
            <small>{usdIn}</small>
          </div>
          <TokenImg token={from} size={36} />
        </AmountCard>
        <AmountCard>
          <div>
            <small>You receive (estimated)</small>
            <strong>{receiveLabel}</strong>
            <small>{usdOut}</small>
          </div>
          <TokenImg token={to} size={36} />
        </AmountCard>
      </Cards>
      <Rows>
        {rows.map(r => (
          <Line key={r.label}>
            <span title={r.tip}>{r.label}</span>
            <span style={{ color: r.color ?? '#fff' }}>{r.value}</span>
          </Line>
        ))}
      </Rows>
      {riskText && (
        <Risk
          role="checkbox"
          aria-checked={ack}
          onClick={() => setAck(a => !a)}
        >
          <Box $on={ack}>
            {ack && <Check size={12} strokeWidth={3.5} color="#fff" />}
          </Box>
          <span>{riskText}</span>
        </Risk>
      )}
      <Fine>
        You will receive at least <strong>{minOutLabel}</strong> or the
        transaction reverts and nothing is spent.
        {needsApproval
          ? ` First swap with ${from.acronym} also asks you to approve spending.`
          : ''}
      </Fine>
      <Button
        size="xl"
        block
        variant={danger ? 'danger' : 'primary'}
        disabled={blocked}
        onClick={() => !blocked && onConfirm()}
      >
        Confirm swap
      </Button>
    </Dialog>
  )
}

export default ReviewSwap
