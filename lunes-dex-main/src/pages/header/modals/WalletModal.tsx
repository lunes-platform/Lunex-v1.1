import React, { useEffect, useRef, useState } from 'react'
import styled, { css } from 'styled-components'
import { Check } from 'lucide-react'
import { Dialog } from 'components/ui/Dialog'
import { C, EASE_OUT, Notice, grotesk, short } from 'components/ui/kit'
import { useToast } from 'components/feedback/ToastProvider'
import { useSDK } from 'context/SDKContext'
import {
  drawStroke,
  fadeIn,
  pop,
  shake,
  spin,
  successRing
} from 'styles/motion'
import { WALLETS, WalletDef, detectInstalled } from './wallets'

const Step = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: ${fadeIn} 200ms ${EASE_OUT} both;
`

const StepLabel = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: ${C.muted};
`

const NetGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
`

const NetCard = styled.div<{ $active?: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 6px;
  border-radius: 12px;
  border: 1px solid ${p => (p.$active ? C.primary : C.border)};
  background: ${p => (p.$active ? 'rgba(108,56,255,0.12)' : 'transparent')};
  opacity: ${p => (p.$active ? 1 : 0.55)};
  img {
    width: 32px;
    height: 32px;
    border-radius: 8px;
  }
  b {
    font-size: 13px;
    font-weight: 600;
  }
  small {
    font-size: 11px;
    color: ${C.secondary};
  }
`

const WalletRow = styled.button`
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid ${C.border};
  background: ${C.bg};
  color: ${C.text};
  text-align: left;
  transition: border-color 150ms ease;
  &:hover,
  &:focus-visible {
    border-color: ${C.primary};
  }
  > img {
    width: 36px;
    height: 36px;
    border-radius: 10px;
  }
`

const WalletInfo = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  b {
    font-weight: 600;
    font-size: 14px;
  }
`

const RowAction = styled.span<{ $install: boolean }>`
  height: 30px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  background: ${p =>
    p.$install ? 'rgba(254,146,63,0.12)' : 'rgba(108,56,255,0.16)'};
  color: ${p => (p.$install ? C.warning : C.primaryText2)};
`

const Center = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 16px 0;
  text-align: center;
  animation: ${fadeIn} 200ms ${EASE_OUT} both;
`

const Ring = styled.div`
  position: relative;
  width: 72px;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 3px solid rgba(108, 56, 255, 0.25);
    border-top-color: ${C.primary};
    animation: ${spin} 0.8s linear infinite;
  }
  img {
    width: 40px;
    height: 40px;
    border-radius: 10px;
  }
`

const SuccessDot = styled.div`
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: ${C.success};
  display: flex;
  align-items: center;
  justify-content: center;
  color: #0d0d0d;
  animation:
    ${pop} 450ms cubic-bezier(0.2, 0.8, 0.2, 1) both,
    ${successRing} 1.2s ease-out 300ms;
  path {
    stroke-dasharray: 24;
    animation: ${drawStroke} 400ms ease 250ms both;
  }
`

const BigTitle = styled.div`
  ${grotesk};
  font-weight: 600;
  font-size: 17px;
`

const MutedText = styled.div`
  font-size: 13px;
  color: ${C.muted};
  max-width: 300px;
  line-height: 1.5;
`

const CancelBtn = styled.button`
  height: 40px;
  padding: 0 18px;
  border-radius: 10px;
  border: 1px solid ${C.borderStrong};
  background: transparent;
  color: ${C.text};
  font-weight: 600;
  font-size: 13px;
  &:hover {
    border-color: ${C.primary};
  }
`

const ErrorNotice = styled(Notice)<{ $k: number }>`
  ${p =>
    p.$k > 0 &&
    css`
      animation: ${shake} 450ms ease both;
    `}
`

const Terms = styled.div`
  font-size: 12px;
  color: ${C.muted};
  text-align: center;
  a {
    color: ${C.primaryText};
    font-weight: 600;
  }
`

type StepId = 'select' | 'connecting' | 'done'

const WalletModal: React.FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose
}) => {
  const sdk = useSDK()
  const { toast } = useToast()
  const [step, setStep] = useState<StepId>('select')
  const [picked, setPicked] = useState<WalletDef | null>(null)
  const [installed, setInstalled] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [errKey, setErrKey] = useState(0)
  const [attemptDone, setAttemptDone] = useState(false)
  const attempt = useRef(0)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>()

  // Detect installed extensions (some inject late — re-check).
  useEffect(() => {
    if (!open) return
    setInstalled(detectInstalled())
    const t = setTimeout(() => setInstalled(detectInstalled()), 500)
    return () => clearTimeout(t)
  }, [open])

  // Reset when (re)opened.
  useEffect(() => {
    if (open) {
      setStep('select')
      setError(null)
      setErrKey(0)
    }
    return () => clearTimeout(closeTimer.current)
  }, [open])

  // Resolve a connection attempt once SDKContext has settled its state.
  useEffect(() => {
    if (!attemptDone || step !== 'connecting' || !picked) return
    setAttemptDone(false)
    if (sdk.isConnected && sdk.walletAddress) {
      setStep('done')
      const addr = sdk.walletAddress
      closeTimer.current = setTimeout(() => {
        onClose()
        toast(
          'success',
          'Wallet connected',
          `${picked.name} · ${short(addr)}`,
          {
            silent: true
          }
        )
      }, 950)
    } else {
      const msg = sdk.error || 'Connection failed. Try again.'
      setError(msg)
      setErrKey(k => k + 1)
      setStep('select')
      toast('error', 'Wallet connection failed', msg, { cat: 'system' })
    }
  }, [attemptDone]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (w: WalletDef) => {
    if (!installed.has(w.source)) {
      window.open(w.installUrl, '_blank', 'noopener,noreferrer')
      toast(
        'info',
        `${w.name} not installed`,
        'Install the extension, then reload Lunex.'
      )
      return
    }
    const id = ++attempt.current
    setError(null)
    setPicked(w)
    setStep('connecting')
    await sdk.connectWallet(w.source)
    // Ignore results of a cancelled attempt.
    if (id === attempt.current) setAttemptDone(true)
  }

  const cancel = () => {
    attempt.current++
    setStep('select')
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Connect wallet"
      description="Lunex never holds your funds. You approve every transaction in your wallet."
    >
      {step === 'select' && (
        <Step>
          {error && (
            <ErrorNotice $tone="critical" $k={errKey} role="alert">
              {error}
            </ErrorNotice>
          )}
          <StepLabel>1 · Network</StepLabel>
          <NetGrid>
            <NetCard $active>
              <img src="/img/lunes.svg" alt="" />
              <b>Lunes</b>
            </NetCard>
            <NetCard aria-disabled="true">
              <img src="/img/ethereum.svg" alt="" />
              <b>Ethereum</b>
              <small>Soon</small>
            </NetCard>
            <NetCard aria-disabled="true">
              <img src="/img/solana.png" alt="" />
              <b>Solana</b>
              <small>Soon</small>
            </NetCard>
          </NetGrid>
          <StepLabel style={{ marginTop: 8 }}>2 · Wallet</StepLabel>
          {WALLETS.map(w => {
            const ok = installed.has(w.source)
            return (
              <WalletRow key={w.source} onClick={() => pick(w)}>
                <img src={w.icon} alt="" />
                <WalletInfo>
                  <b>{w.name}</b>
                  <span
                    style={{
                      fontSize: 12,
                      color: ok ? C.success : C.muted
                    }}
                  >
                    {ok ? 'Detected' : 'Not installed'}
                  </span>
                </WalletInfo>
                <RowAction $install={!ok}>
                  {ok ? 'Connect' : 'Install'}
                </RowAction>
              </WalletRow>
            )
          })}
        </Step>
      )}

      {step === 'connecting' && picked && (
        <Center aria-live="polite">
          <Ring>
            <img src={picked.icon} alt="" />
          </Ring>
          <BigTitle>Waiting for {picked.name}</BigTitle>
          <MutedText>
            Approve the connection request in the extension window.
          </MutedText>
          <CancelBtn onClick={cancel}>Cancel</CancelBtn>
        </Center>
      )}

      {step === 'done' && picked && (
        <Center aria-live="polite" style={{ gap: 12, padding: '20px 0' }}>
          <SuccessDot>
            <Check size={30} strokeWidth={2.5} />
          </SuccessDot>
          <BigTitle style={{ fontSize: 18 }}>Connected</BigTitle>
          <MutedText>
            {picked.name} · {short(sdk.walletAddress)}
          </MutedText>
        </Center>
      )}

      <Terms>
        By connecting you agree to the{' '}
        <a href="https://lunes.io/terms" target="_blank" rel="noreferrer">
          Terms of Service
        </a>
        .
      </Terms>
    </Dialog>
  )
}

export default WalletModal
