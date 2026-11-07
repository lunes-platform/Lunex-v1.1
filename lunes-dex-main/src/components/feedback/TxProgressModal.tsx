/**
 * TxProgressModal — renders the single TxContext transaction.
 *
 * Stepper with an overall bar (width = (current + .5) / steps), active badge
 * glow, wallet hint, "taking longer than usual", rejected (orange) vs error
 * (red, shake), success (check pop + stroke draw + green ring) with hash and
 * explorer link. "Continue in background" hands off to a pending toast.
 */
import React from 'react'
import styled, { css } from 'styled-components'
import { Check, X, Clock, ExternalLink } from 'lucide-react'
import Dialog from '../ui/Dialog'
import { Button, C, grotesk } from '../ui/kit'
import {
  spin,
  pop,
  drawStroke,
  successRing,
  shake,
  stepGlow,
  riseIn,
  softPulse
} from '../../styles/motion'
import { useTx, shortHash } from '../../context/TxContext'
import { NETWORK } from '../../config/contracts'
import { useActiveWalletKind } from '../../wallet/activeWallet'

const EXPLORER: Record<string, string> = {
  testnet: 'https://explorer-test.lunes.io/tx/',
  mainnet: 'https://explorer.lunes.io/tx/'
}

const Top = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  h2 {
    ${grotesk};
    font-size: 20px;
    font-weight: 600;
  }
  p {
    font-size: 14px;
    color: ${C.secondary};
  }
`

const BigSpin = styled.div`
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 3px solid rgba(108, 56, 255, 0.25);
  border-top-color: ${C.primary};
  animation: ${spin} 0.8s linear infinite;
`

const SuccessIcon = styled.div`
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: ${C.success};
  color: #0d0d0d;
  display: flex;
  align-items: center;
  justify-content: center;
  animation:
    ${pop} 450ms cubic-bezier(0.2, 0.8, 0.2, 1) both,
    ${successRing} 1.2s ease-out 300ms 2;
  path {
    stroke-dasharray: 24;
    animation: ${drawStroke} 400ms ease 250ms both;
  }
`

const ErrorIcon = styled.div<{ $rejected: boolean }>`
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: ${p => (p.$rejected ? C.warning : C.critical)};
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: ${p =>
    p.$rejected
      ? css`
          ${pop} 450ms ease both
        `
      : css`
          ${pop} 300ms ease both, ${shake} 450ms ease 300ms
        `};
`

const Progress = styled.div`
  height: 4px;
  border-radius: 999px;
  background: ${C.bg};
  overflow: hidden;
  margin-top: -4px;
  div {
    height: 100%;
    border-radius: 999px;
    transition:
      width 500ms cubic-bezier(0.2, 0.8, 0.2, 1),
      background-color 300ms;
  }
`

const Steps = styled.div`
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  background: ${C.bg};
  padding: 4px 14px;
`

const StepRow = styled.div<{ $first: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-top: ${p => (p.$first ? 'none' : `1px solid ${C.border}`)};
`

const StepBadge = styled.div<{ $bg: string; $fg: string; $glow: boolean }>`
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border-radius: 50%;
  background: ${p => p.$bg};
  color: ${p => p.$fg};
  transition: background-color 300ms ease;
  display: flex;
  align-items: center;
  justify-content: center;
  ${grotesk};
  font-size: 12px;
  font-weight: 700;
  ${p =>
    p.$glow &&
    css`
      animation: ${stepGlow} 1.6s ease-in-out infinite;
    `}
  svg {
    animation: ${pop} 300ms ease both;
  }
`

const MiniSpin = styled.span`
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: ${spin} 0.6s linear infinite;
`

const Hint = styled.div<{ $tone: 'primary' | 'warning' }>`
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.45;
  animation: ${riseIn} 200ms ease;
  ${p =>
    p.$tone === 'primary'
      ? css`
          background: rgba(108, 56, 255, 0.1);
          border: 1px solid ${C.primaryBorder};
          color: ${C.primaryText2};
        `
      : css`
          align-items: flex-start;
          background: rgba(254, 146, 63, 0.1);
          border: 1px solid rgba(254, 146, 63, 0.35);
          color: ${C.warning};
        `}
  img {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    animation: ${softPulse} 1.6s ease-in-out infinite;
  }
  svg {
    flex-shrink: 0;
    margin-top: 1px;
  }
`

const ErrorBox = styled.div<{ $rejected: boolean }>`
  padding: 12px 14px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
  ${p =>
    p.$rejected
      ? css`
          background: rgba(254, 146, 63, 0.1);
          border: 1px solid rgba(254, 146, 63, 0.35);
          color: ${C.warning};
        `
      : css`
          background: rgba(255, 40, 76, 0.1);
          border: 1px solid rgba(255, 93, 105, 0.35);
          color: ${C.criticalText2};
        `}
`

const HashRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  span {
    color: ${C.muted};
    font-family: ui-monospace, monospace;
  }
  a {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
  }
`

export const TxProgressModal: React.FC = () => {
  const { tx, background, close, retry } = useTx()
  const onPhone = useActiveWalletKind() === 'walletconnect'
  if (!tx || tx.hidden) return null

  const { cfg, status, current } = tx
  const n = cfg.steps.length
  const active = status === 'active'
  const success = status === 'success'
  const rejected = status === 'rejected'
  const failed = status === 'error' || rejected

  const pct = success ? 100 : Math.min(100, ((current + 0.5) / n) * 100)
  const barColor = success
    ? C.success
    : rejected
      ? C.warning
      : status === 'error'
        ? C.critical
        : C.primary
  const curStep = cfg.steps[Math.min(current, n - 1)]
  const walletHint = active && !!curStep?.wallet

  const title = success
    ? cfg.successTitle
    : rejected
      ? 'Request rejected'
      : status === 'error'
        ? 'Transaction failed'
        : cfg.title
  const errorText = rejected
    ? 'You declined the request in your wallet. Nothing was sent and no fees were charged.'
    : tx.error

  return (
    <Dialog
      open
      onClose={active ? background : close}
      ariaLabel="Transaction status"
      width={420}
      zIndex={65}
      hideClose
    >
      <div aria-live="polite" style={{ display: 'contents' }}>
        <Top>
          {active && <BigSpin data-motion="pulse" />}
          {success && (
            <SuccessIcon>
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </SuccessIcon>
          )}
          {failed && (
            <ErrorIcon $rejected={rejected}>
              <X size={26} strokeWidth={2.5} />
            </ErrorIcon>
          )}
          <h2>{title}</h2>
          <p>{cfg.summary}</p>
        </Top>

        <Progress>
          <div style={{ width: `${pct}%`, background: barColor }} />
        </Progress>

        <Steps>
          {cfg.steps.map((st, i) => {
            const done = success || i < current
            const isActive = active && i === current
            const isErr = failed && i === current
            const bg = done
              ? C.success
              : isErr
                ? rejected
                  ? C.warning
                  : C.critical
                : isActive
                  ? C.primary
                  : C.field
            const fg = done
              ? '#0D0D0D'
              : isActive || isErr
                ? '#FFFFFF'
                : C.muted
            return (
              <StepRow key={i} $first={i === 0}>
                <StepBadge $bg={bg} $fg={fg} $glow={isActive}>
                  {done ? (
                    <Check size={14} strokeWidth={3} />
                  ) : isActive ? (
                    <MiniSpin data-motion="pulse" />
                  ) : isErr ? (
                    <X size={14} strokeWidth={3} />
                  ) : (
                    i + 1
                  )}
                </StepBadge>
                <span
                  style={{
                    fontSize: 14,
                    color: done || isActive || isErr ? '#FFFFFF' : C.muted,
                    fontWeight: isActive ? 600 : 400
                  }}
                >
                  {st.label}
                </span>
              </StepRow>
            )
          })}
        </Steps>

        {walletHint && (
          <Hint $tone="primary">
            <img src="/img/lunes-wallet.svg" alt="" />
            {onPhone
              ? 'Approve the request on your phone'
              : 'Approve the request in Lunes Wallet'}
          </Hint>
        )}
        {active && tx.slow && (
          <Hint $tone="warning" role="status">
            <Clock size={16} strokeWidth={2} />
            Taking longer than usual — the network is congested. Your funds are
            safe; you can close this and we will notify you.
          </Hint>
        )}
        {failed && errorText && (
          <ErrorBox role="alert" $rejected={rejected}>
            {errorText}
          </ErrorBox>
        )}
        {success && tx.hash && (
          <HashRow>
            <span>{shortHash(tx.hash)}</span>
            <a
              href={`${EXPLORER[NETWORK.name] ?? EXPLORER.testnet}${tx.hash}`}
              target="_blank"
              rel="noreferrer"
            >
              View on explorer
              <ExternalLink size={13} strokeWidth={2} />
            </a>
          </HashRow>
        )}

        {active && (
          <Button variant="secondary" size="lg" block onClick={background}>
            Continue in background
          </Button>
        )}
        {success && (
          <Button
            size="xl"
            block
            onClick={close}
            style={{ height: 52, fontSize: 16 }}
          >
            Done
          </Button>
        )}
        {failed && (
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="secondary"
              size="xl"
              block
              onClick={close}
              style={{ height: 52, fontSize: 15 }}
            >
              Close
            </Button>
            <Button
              size="xl"
              block
              onClick={retry}
              style={{ height: 52, fontSize: 15 }}
            >
              Try again
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  )
}

export default TxProgressModal
