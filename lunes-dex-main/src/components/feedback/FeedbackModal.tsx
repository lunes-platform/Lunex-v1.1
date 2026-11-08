/**
 * "Report a bug / Feedback" (P0-10). Anonymous by default: the connected
 * wallet address and the last transaction hash are only attached when the
 * tester ticks the matching box. App version, network and page are added by
 * `submitFeedback`. Stored by spot-api `POST /api/v1/feedback`.
 */
import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { MessageSquareWarning } from 'lucide-react'
import Dialog from '../ui/Dialog'
import { Button, C, Label, Muted, Notice, Textarea } from '../ui/kit'
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_MAX,
  FEEDBACK_MIN,
  submitFeedback,
  type FeedbackCategory,
  type FeedbackInput
} from '../../services/telemetry'

const Select = styled.select`
  height: 44px;
  border-radius: 12px;
  border: 1px solid ${C.border};
  background: ${C.field};
  color: ${C.text};
  padding: 0 12px;
  font-size: 14px;
`

const Check = styled.label`
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  color: ${C.body};
  cursor: pointer;
  code {
    font-size: 12px;
    color: ${C.primaryText};
  }
`

const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`

export type FeedbackModalProps = {
  open: boolean
  onClose: () => void
  walletAddress?: string | null
  lastTxHash?: string | null
  submit?: (input: FeedbackInput) => ReturnType<typeof submitFeedback>
}

export const FeedbackModal: React.FC<FeedbackModalProps> = ({
  open,
  onClose,
  walletAddress,
  lastTxHash,
  submit = input => submitFeedback(input)
}) => {
  const [category, setCategory] = useState<FeedbackCategory>('BUG')
  const [message, setMessage] = useState('')
  const [attachWallet, setAttachWallet] = useState(false)
  const [attachTx, setAttachTx] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [doneId, setDoneId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setDoneId(null)
  }, [open])

  const len = message.trim().length
  const valid = len >= FEEDBACK_MIN && len <= FEEDBACK_MAX

  const send = async () => {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    const res = await submit({
      category,
      message,
      walletAddress: attachWallet && walletAddress ? walletAddress : undefined,
      txHash: attachTx && lastTxHash ? lastTxHash : undefined
    })
    setBusy(false)
    if (res.ok) {
      setDoneId(res.id)
      setMessage('')
      setAttachWallet(false)
      setAttachTx(false)
    } else {
      setError(res.error)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      locked={busy}
      title="Report a bug / Feedback"
      description="Anonymous. Never include seed phrases, private keys or passwords."
      width={480}
    >
      {doneId !== null ? (
        <>
          <Notice $tone="success" role="status">
            Thanks! Your report was received
            {doneId ? ` (ref ${doneId.slice(0, 8)})` : ''}.
          </Notice>
          <Button block onClick={onClose}>
            Close
          </Button>
        </>
      ) : (
        <>
          <Label htmlFor="fb-category">Category</Label>
          <Select
            id="fb-category"
            value={category}
            onChange={e => setCategory(e.target.value as FeedbackCategory)}
          >
            {FEEDBACK_CATEGORIES.map(c => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
          <Label htmlFor="fb-message">What happened?</Label>
          <Textarea
            id="fb-message"
            rows={6}
            maxLength={FEEDBACK_MAX}
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Steps to reproduce, what you expected and what you saw."
          />
          <Muted $size={11}>
            {len}/{FEEDBACK_MAX}
          </Muted>
          {walletAddress && (
            <Check>
              <input
                type="checkbox"
                checked={attachWallet}
                onChange={e => setAttachWallet(e.target.checked)}
              />
              Attach my wallet address <code>{short(walletAddress)}</code>{' '}
              (optional)
            </Check>
          )}
          {lastTxHash && (
            <Check>
              <input
                type="checkbox"
                checked={attachTx}
                onChange={e => setAttachTx(e.target.checked)}
              />
              Attach my last transaction <code>{short(lastTxHash)}</code>
            </Check>
          )}
          {error && (
            <Notice $tone="critical" role="alert">
              {error}
            </Notice>
          )}
          <Button block disabled={!valid || busy} onClick={send}>
            {busy ? 'Sending…' : 'Send report'}
          </Button>
        </>
      )}
    </Dialog>
  )
}

const Fab = styled.button`
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 44;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid ${C.primaryBorder};
  background: rgba(26, 26, 26, 0.92);
  color: ${C.primaryText2};
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  backdrop-filter: blur(6px);
  @media (max-width: 759px) {
    bottom: calc(76px + env(safe-area-inset-bottom));
    span {
      display: none;
    }
  }
`

/** Floating trigger; context (wallet, last tx) is provided by the caller. */
export const FeedbackButton: React.FC<{
  walletAddress?: string | null
  lastTxHash?: string | null
  bottomOffset?: number
}> = ({ walletAddress, lastTxHash, bottomOffset }) => {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Fab
        type="button"
        aria-label="Report a bug or send feedback"
        onClick={() => setOpen(true)}
        style={bottomOffset ? { bottom: bottomOffset } : undefined}
      >
        <MessageSquareWarning size={14} strokeWidth={2} />
        <span>Report a bug</span>
      </Fab>
      <FeedbackModal
        open={open}
        onClose={() => setOpen(false)}
        walletAddress={walletAddress}
        lastTxHash={lastTxHash}
      />
    </>
  )
}

export default FeedbackModal
