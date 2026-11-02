import React, { useCallback, useState } from 'react'
import styled from 'styled-components'
import { Check, Copy, Send } from 'lucide-react'
import { useSpot } from 'context/SpotContext'
import { Dialog } from 'components/ui/Dialog'
import { Button, C, grotesk, tabular } from 'components/ui/kit'
import { useToast } from 'components/feedback/ToastProvider'
import { fmtPx } from '../terminal'

const LinkBox = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 6px 0 14px;
  border-radius: 12px;
  border: 1px solid ${C.borderStrong};
  background: ${C.bg};
  span {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    color: ${C.body};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const Preview = styled.div`
  ${tabular};
  padding: 12px 14px;
  border-radius: 12px;
  background: ${C.bg};
  font-size: 13px;
  color: ${C.secondary};
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
`

const Socials = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
`

const SocialLink = styled.a`
  ${grotesk};
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 10px;
  border: 1px solid ${C.borderStrong};
  color: ${C.text};
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  transition: border-color 150ms ease;
  &:hover {
    border-color: ${C.primary};
  }
`

const XIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
)

/** Share market: copy link (toast) + X / Telegram intents. */
const ShareModal: React.FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose
}) => {
  const { selectedPair, ticker } = useSpot()
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)

  const slug = selectedPair.replace('/', '-')
  const url = `${window.location.origin}/spot?pair=${encodeURIComponent(slug)}`
  const price = ticker?.lastPrice ?? 0
  const chg = ticker?.change24h ?? 0
  const message = `Trade ${selectedPair} on Lunex DEX${
    price > 0
      ? ` — ${fmtPx(price)} (${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%)`
      : ''
  }\n${url}`

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast('success', 'Market link copied', url.replace(/^https?:\/\//, ''), {
        silent: true
      })
    } catch {
      toast(
        'error',
        'Could not copy the link',
        'Copy it manually from the box.',
        {
          silent: true
        }
      )
    }
  }, [url, toast])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Share market"
      description={`Send ${selectedPair} to a friend or your community.`}
      width={440}
      padding={22}
    >
      <LinkBox>
        <span title={url}>{url}</span>
        <Button size="sm" variant="secondary" onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </LinkBox>
      <Preview>{message}</Preview>
      <Socials>
        <SocialLink
          href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <XIcon /> Post on X
        </SocialLink>
        <SocialLink
          href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(`Trade ${selectedPair} on Lunex DEX`)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Send size={14} /> Telegram
        </SocialLink>
      </Socials>
    </Dialog>
  )
}

export default ShareModal
