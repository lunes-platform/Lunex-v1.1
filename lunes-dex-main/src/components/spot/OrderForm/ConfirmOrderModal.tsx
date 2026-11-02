import React from 'react'
import styled from 'styled-components'
import { calcFeeBreakdown } from 'services/spotService'
import { Dialog } from 'components/ui/Dialog'
import { Button, C, tabular } from 'components/ui/kit'
import { T, fmtAmt, nf } from '../terminal'

export type OrderKind = 'Limit' | 'Market' | 'Stop' | 'Stop-Limit'

export type PendingOrder = {
  pair: string
  base: string
  quote: string
  type: OrderKind
  side: 'buy' | 'sell'
  /** Limit price, or the estimate for Market / Stop. */
  price: number
  stop: number | null
  amount: number
  total: number
  fee: number
  feeRate: number
  isMaker: boolean
  dp: number
}

const Rows = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-radius: 12px;
  background: ${C.bg};
  padding: 6px 14px;
`

const Row = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  font-size: 13px;
  span:first-child {
    color: ${C.muted};
  }
  span:last-child {
    ${tabular};
    font-weight: 500;
    text-align: right;
  }
`

const SplitLabel = styled.span`
  font-size: 12px;
  color: ${C.muted};
`

const Split = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  margin-top: -10px;
`

const SplitTile = styled.div`
  padding: 8px;
  border-radius: 8px;
  background: ${C.bg};
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  span:first-child {
    font-size: 10px;
    color: ${C.muted};
  }
  span:last-child {
    ${tabular};
    font-size: 12px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`

const Actions = styled.div`
  display: flex;
  gap: 8px;
  > button:last-child {
    flex: 1.4;
  }
  > button:first-child {
    flex: 1;
  }
`

const ConfirmBtn = styled(Button)<{ $buy: boolean }>`
  background: ${p => (p.$buy ? T.up : T.sell)};
  color: ${p => (p.$buy ? T.bg : '#fff')};
  &:hover:not(:disabled) {
    background: ${p => (p.$buy ? '#1BB277' : '#DB1D4E')};
  }
`

/**
 * Review step before signing. The fee and its split are display-only:
 * rates come from the pair (spot-api), the split from SPOT_FEE_SPLIT.
 */
const ConfirmOrderModal: React.FC<{
  order: PendingOrder | null
  onClose: () => void
  onConfirm: (o: PendingOrder) => void
}> = ({ order, onClose, onConfirm }) => {
  const o = order
  const split = o ? calcFeeBreakdown(o.fee, o.isMaker) : null
  const buy = o?.side === 'buy'

  return (
    <Dialog
      open={!!o}
      onClose={onClose}
      title={o ? `Confirm ${o.type.toLowerCase()} ${o.side}` : ''}
      width={400}
      padding={22}
      zIndex={60}
    >
      {o && split && (
        <>
          <Rows>
            <Row>
              <span>Market</span>
              <span>{o.pair}</span>
            </Row>
            <Row>
              <span>Type</span>
              <span style={{ color: buy ? T.upText : T.downText }}>
                {o.type} · {buy ? 'Buy' : 'Sell'}
              </span>
            </Row>
            {o.stop ? (
              <Row>
                <span>Trigger</span>
                <span style={{ color: C.warning }}>
                  {nf(o.stop, o.dp)} {o.quote}
                </span>
              </Row>
            ) : null}
            <Row>
              <span>
                {o.type === 'Market' || o.type === 'Stop'
                  ? 'Estimate'
                  : 'Price'}
              </span>
              <span>
                {o.price > 0 ? `${nf(o.price, o.dp)} ${o.quote}` : '—'}
              </span>
            </Row>
            <Row>
              <span>Amount</span>
              <span>
                {fmtAmt(o.amount)} {o.base}
              </span>
            </Row>
            <Row>
              <span>Total</span>
              <span>{o.total > 0 ? `${nf(o.total, 2)} ${o.quote}` : '—'}</span>
            </Row>
            <Row>
              <span>
                Fee ({o.isMaker ? 'maker' : 'taker'}{' '}
                {(o.feeRate * 100).toFixed(2)}%)
              </span>
              <span>
                ≈ {fmtAmt(o.fee)} {o.quote}
              </span>
            </Row>
          </Rows>
          <SplitLabel>Where the fee goes</SplitLabel>
          <Split>
            {(
              [
                ['Team', split.team],
                ['Stakers', split.stakers],
                ['Affiliates', split.affiliates],
                ['Treasury', split.treasury]
              ] as Array<[string, number]>
            ).map(([l, v]) => (
              <SplitTile key={l}>
                <span>{l}</span>
                <span>{fmtAmt(v)}</span>
              </SplitTile>
            ))}
          </Split>
          <Actions>
            <Button variant="secondary" size="lg" onClick={onClose}>
              Cancel
            </Button>
            <ConfirmBtn size="lg" $buy={buy} onClick={() => onConfirm(o)}>
              Confirm
            </ConfirmBtn>
          </Actions>
        </>
      )}
    </Dialog>
  )
}

export default ConfirmOrderModal
