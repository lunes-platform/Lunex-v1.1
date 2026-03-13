/**
 * TransactionProgress — Multi-step animated transaction flow UI
 *
 * Usage:
 *   <TransactionProgress
 *     steps={['Preparing transaction', 'Waiting for signature', 'Broadcasting', 'Confirmed']}
 *     currentStep={2}
 *     status="active"     // 'active' | 'success' | 'error'
 *     txHash="0x..."      // optional, shows on success
 *   />
 */
import React from 'react'
import styled from 'styled-components'
import { fadeInUp, spin, checkmark, timing, easing } from '../../styles/motion'
import { keyframes } from 'styled-components'

const errorShake = keyframes`
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-4px); }
  40%, 80% { transform: translateX(4px); }
`

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
  animation: ${fadeInUp} ${timing.fast} ${easing.decelerate} both;
`

const Card = styled.div`
  background: #232323;
  border: 1px solid #2A2A2C;
  border-radius: 20px;
  padding: 32px;
  width: 100%;
  max-width: 400px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
`

const Title = styled.h3`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 18px;
  font-weight: 700;
  color: #FFFFFF;
  margin: 0 0 24px;
  text-align: center;
`

const StepList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0;
`

const StepRow = styled.div<{ active?: boolean; complete?: boolean; error?: boolean }>`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 0;
  border-bottom: 1px solid #1A1A1A;
  animation: ${({ error }) => (error ? errorShake : 'none')} 0.4s ease;

  &:last-child {
    border-bottom: none;
  }
`

const StepIcon = styled.div<{ active?: boolean; complete?: boolean; error?: boolean }>`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 700;
  font-family: 'Space Grotesk', sans-serif;
  transition: all ${timing.normal} ${easing.default};

  ${({ complete }) =>
        complete &&
        `
    background: #26D07C;
    color: #FFFFFF;
  `}

  ${({ active }) =>
        active &&
        `
    background: #6C38FF;
    color: #FFFFFF;
    box-shadow: 0 0 16px rgba(108, 56, 255, 0.3);
  `}

  ${({ error }) =>
        error &&
        `
    background: #FF284C;
    color: #FFFFFF;
  `}

  ${({ active, complete, error }) =>
        !active &&
        !complete &&
        !error &&
        `
    background: #2A2A2C;
    color: #47474A;
  `}
`

const SpinnerIcon = styled.div`
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #FFFFFF;
  border-radius: 50%;
  animation: ${spin} 0.6s linear infinite;
`

const StepLabel = styled.div<{ active?: boolean; complete?: boolean }>`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  color: ${({ active, complete }) => (active || complete ? '#FFFFFF' : '#47474A')};
  font-weight: ${({ active }) => (active ? 600 : 400)};
  transition: color ${timing.fast} ${easing.default};
`

const TxHash = styled.div`
  margin-top: 16px;
  text-align: center;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: #47474A;
  word-break: break-all;
`

const CheckSvg = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <polyline points="20 6 9 17 4 12" style={{ strokeDasharray: 24, strokeDashoffset: 0 }} />
    </svg>
)

const ErrorSvg = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
)

interface TransactionProgressProps {
    steps: string[]
    currentStep: number
    status: 'active' | 'success' | 'error'
    txHash?: string
    onClose?: () => void
    errorMessage?: string
}

const TransactionProgress: React.FC<TransactionProgressProps> = ({
    steps,
    currentStep,
    status,
    txHash,
    onClose,
    errorMessage,
}) => {
    const title =
        status === 'success'
            ? 'Transaction Confirmed'
            : status === 'error'
                ? 'Transaction Failed'
                : 'Processing Transaction...'

    return (
        <Overlay onClick={status !== 'active' ? onClose : undefined}>
            <Card onClick={(e) => e.stopPropagation()}>
                <Title>{title}</Title>
                <StepList>
                    {steps.map((step, i) => {
                        const isComplete = i < currentStep || status === 'success'
                        const isActive = i === currentStep && status === 'active'
                        const isError = i === currentStep && status === 'error'

                        return (
                            <StepRow key={i} active={isActive} complete={isComplete} error={isError}>
                                <StepIcon active={isActive} complete={isComplete} error={isError}>
                                    {isComplete ? (
                                        <CheckSvg />
                                    ) : isActive ? (
                                        <SpinnerIcon />
                                    ) : isError ? (
                                        <ErrorSvg />
                                    ) : (
                                        i + 1
                                    )}
                                </StepIcon>
                                <StepLabel active={isActive} complete={isComplete}>
                                    {isError && errorMessage ? errorMessage : step}
                                </StepLabel>
                            </StepRow>
                        )
                    })}
                </StepList>

                {txHash && status === 'success' && (
                    <TxHash>Tx: {txHash.slice(0, 16)}...{txHash.slice(-8)}</TxHash>
                )}
            </Card>
        </Overlay>
    )
}

export default TransactionProgress
