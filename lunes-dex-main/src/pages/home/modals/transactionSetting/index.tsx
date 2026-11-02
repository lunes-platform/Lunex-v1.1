/**
 * Swap settings — inline panel under the card header (prototype "settings
 * popover"): slippage 0.1 / 0.5 / 1% + custom, warning outside 0.1–1%, and
 * the transaction deadline in minutes.
 */
import React, { useState } from 'react'
import styled from 'styled-components'
import { AlertTriangle } from 'lucide-react'
import { C, EASE_OUT, grotesk, tabular } from 'components/ui/kit'
import { riseIn } from 'styles/motion'

const PRESETS = [0.1, 0.5, 1]

export const slippageWarning = (s: number) =>
  s > 1
    ? 'High slippage — your trade may be front-run and fill at a worse price.'
    : s < 0.1
      ? 'Very low slippage — the swap may fail if the price moves.'
      : null

const Box = styled.div`
  background: ${C.surface};
  border: 1px solid ${C.borderStrong};
  border-radius: 16px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 8px;
  animation: ${riseIn} 200ms ${EASE_OUT} both;
`

const Head = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  > strong {
    ${grotesk};
    font-weight: 600;
    font-size: 14px;
  }
  > span {
    font-size: 12px;
    color: ${C.muted};
  }
`

const Opts = styled.div`
  display: flex;
  gap: 6px;
`

const Opt = styled.button<{ $active: boolean }>`
  ${grotesk};
  flex: 1;
  height: 38px;
  border-radius: 10px;
  border: none;
  background: ${p => (p.$active ? C.primary : C.field)};
  color: #fff;
  font-weight: 600;
  font-size: 14px;
  transition: background-color 150ms ease;
  &:hover {
    background: ${p => (p.$active ? C.primaryHover : C.borderStrong)};
  }
`

const InputBox = styled.label<{ $active?: boolean; $w?: string }>`
  flex: ${p => (p.$w ? 'none' : 1.2)};
  width: ${p => p.$w ?? 'auto'};
  display: flex;
  align-items: center;
  gap: 4px;
  height: 38px;
  border-radius: 10px;
  border: 1px solid ${p => (p.$active ? C.primary : C.borderStrong)};
  background: ${C.bg};
  padding: 0 10px;
  &:focus-within {
    border-color: ${C.primary};
  }
  input {
    width: 100%;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: #fff;
    font-size: 14px;
    text-align: right;
    ${tabular};
  }
  span {
    color: ${C.muted};
    font-size: 13px;
  }
`

const Warn = styled.div`
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 12px;
  line-height: 1.5;
  color: ${C.warning};
  svg {
    flex-shrink: 0;
    margin-top: 2px;
  }
`

type Props = {
  slippage: number
  deadline: number
  onSlippage: (v: number) => void
  onDeadline: (v: number) => void
}

const SwapSettings: React.FC<Props> = ({
  slippage,
  deadline,
  onSlippage,
  onDeadline
}) => {
  const [custom, setCustom] = useState(
    PRESETS.includes(slippage) ? '' : String(slippage)
  )
  const [dl, setDl] = useState(String(deadline))
  const warn = slippageWarning(slippage)

  const onCustom = (raw: string) => {
    const v = raw.replace(',', '.').replace(/[^0-9.]/g, '')
    setCustom(v)
    const n = Number(v)
    if (v && Number.isFinite(n) && n > 0 && n < 50) onSlippage(n)
    if (!v) onSlippage(0.5)
  }

  const onDl = (raw: string) => {
    const v = raw.replace(/[^0-9]/g, '').slice(0, 4)
    setDl(v)
    const n = Number(v)
    if (n >= 1 && n <= 4320) onDeadline(n)
  }

  return (
    <Box id="swap-settings">
      <Head>
        <strong>Slippage tolerance</strong>
        <span>Max price change you accept</span>
      </Head>
      <Opts>
        {PRESETS.map(v => (
          <Opt
            key={v}
            $active={slippage === v && !custom}
            aria-pressed={slippage === v && !custom}
            onClick={() => {
              setCustom('')
              onSlippage(v)
            }}
          >
            {v}%
          </Opt>
        ))}
        <InputBox $active={!!custom}>
          <input
            value={custom}
            onChange={e => onCustom(e.target.value)}
            placeholder="Custom"
            inputMode="decimal"
            aria-label="Custom slippage"
            data-bare=""
          />
          <span>%</span>
        </InputBox>
      </Opts>
      {warn && (
        <Warn role="status">
          <AlertTriangle size={14} strokeWidth={2} />
          {warn}
        </Warn>
      )}
      <Head>
        <strong>Transaction deadline</strong>
        <InputBox $w="120px">
          <input
            value={dl}
            onChange={e => onDl(e.target.value)}
            onBlur={() => setDl(String(deadline))}
            inputMode="numeric"
            aria-label="Deadline in minutes"
            data-bare=""
          />
          <span>min</span>
        </InputBox>
      </Head>
    </Box>
  )
}

export default SwapSettings
