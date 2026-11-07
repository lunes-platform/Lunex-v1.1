import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { Dialog } from 'components/ui/Dialog'
import { Button, C, Panel, grotesk, tabular } from 'components/ui/kit'
import { useSDK } from '../../../context/SDKContext'
import { useToast } from '../../../components/feedback/ToastProvider'
import { Trader } from '../../social/types'
import {
  fmtPct,
  fmtUsd,
  TraderAvatar,
  traderVaultToken
} from '../../social/shared'
import { useCopyDeposit } from '../useCopytrade'
import { requestWalletConnect } from 'pages/header/modals/wallets'

const AmountInput = styled.input.attrs({ 'data-bare': '' })`
  background: transparent;
  border: none;
  outline: none;
  color: #fff;
  ${grotesk};
  ${tabular};
  font-size: 26px;
  font-weight: 500;
  padding: 0;
  width: 100%;
  min-width: 0;
`

const PanelHead = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  color: ${C.muted};
`

const InputRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  span {
    ${grotesk};
    font-weight: 600;
    color: ${C.secondary};
  }
`

const SliderHead = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  span:first-child {
    color: ${C.muted};
  }
  span:last-child {
    font-weight: 600;
    ${tabular};
  }
`

const Range = styled.input.attrs({ type: 'range' })`
  width: 100%;
  accent-color: ${C.primary};
`

const Fine = styled.p`
  font-size: 12px;
  line-height: 1.5;
  color: ${C.muted};
`

const Who = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: -4px;
  font-size: 12px;
  color: ${C.muted};
  ${tabular};
`

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

type CopyTarget = Pick<
  Trader,
  'id' | 'name' | 'fee' | 'isAI' | 'roi30d' | 'winRate' | 'avatar' | 'vault'
>

interface CopyModalProps {
  trader: CopyTarget | null
  onClose: () => void
  /** Called after the deposit is confirmed (refresh positions etc.). */
  onSuccess?: () => void
}

const CopyModal: React.FC<CopyModalProps> = ({
  trader,
  onClose,
  onSuccess
}) => {
  const [amount, setAmount] = useState('')
  // PLACEHOLDER: no backend yet — the copy stop-loss is shown but not sent
  // (the deposit API has no stop-loss field).
  const [stop, setStop] = useState(20)
  const [connecting, setConnecting] = useState(false)
  const { walletAddress } = useSDK()
  const { toast } = useToast()
  const deposit = useCopyDeposit()

  useEffect(() => {
    setAmount('')
    setStop(20)
  }, [trader?.id])

  const token = traderVaultToken(trader)
  const minDeposit = trader?.vault?.minDeposit ?? 0
  const amt = Number(amount)

  let cta: { label: string; ok: boolean; on?: () => void }
  if (!walletAddress) {
    cta = {
      label: connecting ? 'Connecting…' : 'Connect wallet',
      ok: !connecting,
      on: () => {
        setConnecting(true)
        requestWalletConnect()
          .catch((err: unknown) =>
            toast(
              'error',
              'Wallet not connected',
              err instanceof Error ? err.message : undefined
            )
          )
          .finally(() => setConnecting(false))
      }
    }
  } else if (!amount || !(amt > 0)) {
    cta = { label: 'Enter an amount', ok: false }
  } else if (minDeposit > 0 && amt < minDeposit) {
    cta = {
      label: `Minimum deposit is ${minDeposit.toLocaleString()} ${token}`,
      ok: false
    }
  } else {
    cta = {
      label: `Start copying with ${fmtUsd(amt)}`,
      ok: true,
      on: () => {
        if (!trader) return
        const t = trader
        onClose()
        deposit({
          leaderId: t.id,
          leaderName: t.name,
          token,
          amount,
          onSuccess
        })
      }
    }
  }

  return (
    <Dialog
      open={!!trader}
      onClose={onClose}
      width={420}
      ariaLabel="Copy trader"
      title={trader ? `Copy ${trader.name}` : 'Copy trader'}
    >
      {trader && (
        <>
          <Who>
            <TraderAvatar
              name={trader.name}
              avatar={trader.avatar}
              ai={trader.isAI}
              size={40}
            />
            <span>
              ROI 30d{' '}
              <b
                style={{
                  color: trader.roi30d >= 0 ? C.success : C.criticalText
                }}
              >
                {fmtPct(trader.roi30d)}
              </b>{' '}
              · win rate {trader.winRate}%
            </span>
          </Who>

          <Panel>
            <PanelHead>
              <span>Allocate ({token})</span>
              {minDeposit > 0 && (
                <span>
                  Min. {minDeposit.toLocaleString()} {token}
                </span>
              )}
            </PanelHead>
            <InputRow>
              <AmountInput
                value={amount}
                onChange={e => {
                  const v = e.target.value.replace(',', '.')
                  if (/^\d*\.?\d*$/.test(v)) setAmount(v)
                }}
                placeholder="0"
                inputMode="decimal"
                aria-label="Allocation"
                autoFocus
              />
              <span>{token}</span>
            </InputRow>
          </Panel>

          <Stack>
            <SliderHead>
              <span>Stop copying if loss reaches</span>
              <span>−{stop}%</span>
            </SliderHead>
            <Range
              min={5}
              max={50}
              step={5}
              value={stop}
              onChange={e => setStop(Number(e.target.value))}
              aria-label="Stop loss"
            />
          </Stack>

          <Fine>
            Trades are mirrored proportionally. The trader never controls your
            funds and you can stop copying at any time. Leader fee: {trader.fee}
            % of profits (high-water mark).
          </Fine>

          <Button
            size="xl"
            block
            disabled={!cta.ok}
            onClick={cta.on}
            style={{ height: 52, borderRadius: 14, fontSize: 16 }}
          >
            {cta.label}
          </Button>
        </>
      )}
    </Dialog>
  )
}

export default CopyModal
