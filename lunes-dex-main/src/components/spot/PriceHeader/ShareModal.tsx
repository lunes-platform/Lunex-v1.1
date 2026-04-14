import React, { useState, useCallback } from 'react'
import styled, { keyframes } from 'styled-components'
import { useSpot } from 'context/SpotContext'

const fadeIn = keyframes`
  from { opacity: 0; }
  to   { opacity: 1; }
`

const slideUp = keyframes`
  from { opacity: 0; transform: translateY(16px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
`

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: ${fadeIn} 0.15s ease;
`

const Modal = styled.div`
  background: #1a1a1a;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  width: 380px;
  max-width: 90vw;
  padding: 24px;
  animation: ${slideUp} 0.25s ease;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
`

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
`

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`

const TitleIcon = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgba(108, 56, 255, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6c38ff;
  flex-shrink: 0;
`

const Title = styled.h3`
  font-size: 18px;
  font-weight: 700;
  font-family: 'Space Grotesk', sans-serif;
  color: #ffffff;
  margin: 0;
`

const CloseBtn = styled.button`
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  font-size: 14px;
  transition: all 0.15s;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }
`

const LinkBox = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 16px;
`

const LinkText = styled.span`
  flex: 1;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
`

const CopyBtn = styled.button<{ copied?: boolean }>`
  background: ${({ copied }) =>
    copied ? 'rgba(0, 192, 118, 0.15)' : 'rgba(108, 56, 255, 0.15)'};
  border: 1px solid
    ${({ copied }) =>
      copied ? 'rgba(0, 192, 118, 0.3)' : 'rgba(108, 56, 255, 0.3)'};
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 600;
  font-family: 'Space Grotesk', sans-serif;
  color: ${({ copied }) => (copied ? '#00C076' : '#6C38FF')};
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;

  &:hover {
    background: ${({ copied }) =>
      copied ? 'rgba(0, 192, 118, 0.2)' : 'rgba(108, 56, 255, 0.25)'};
  }
`

const ShareLabel = styled.span`
  display: block;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 10px;
  font-family: 'Space Grotesk', sans-serif;
`

const SocialGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
`

const SocialBtn = styled.a`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  font-weight: 600;
  font-family: 'Space Grotesk', sans-serif;
  text-decoration: none;
  transition: all 0.15s;
  cursor: pointer;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
    border-color: rgba(255, 255, 255, 0.15);
  }
`

const MessagePreview = styled.div`
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 12px;
  margin-top: 16px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  line-height: 1.5;
`

interface Props {
  onClose: () => void
}

const ShareModal: React.FC<Props> = ({ onClose }) => {
  const { selectedPair, ticker } = useSpot()
  const [copied, setCopied] = useState(false)

  const pairSlug = selectedPair.replace('/', '-')
  const shareUrl = `${window.location.origin}/spot/${pairSlug}`
  const price = ticker?.lastPrice ?? 0
  const change = ticker?.change24h ?? 0

  const shareMessage = `Trade ${selectedPair} on Lunex DEX${price > 0 ? ` — $${price >= 1 ? price.toFixed(4) : price.toFixed(8)} (${change >= 0 ? '+' : ''}${change.toFixed(2)}%)` : ''}\n${shareUrl}`

  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareMessage)}`
  const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(`Trade ${selectedPair} on Lunex DEX`)}`

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = shareUrl
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [shareUrl])

  return (
    <Overlay onClick={onClose}>
      <Modal onClick={e => e.stopPropagation()}>
        <Header>
          <TitleRow>
            <TitleIcon>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            </TitleIcon>
            <Title>Share Market</Title>
          </TitleRow>
          <CloseBtn onClick={onClose}>✕</CloseBtn>
        </Header>

        <LinkBox>
          <LinkText>{shareUrl}</LinkText>
          <CopyBtn copied={copied} onClick={handleCopy}>
            {copied ? '✓ Copied' : 'Copy'}
          </CopyBtn>
        </LinkBox>

        <ShareLabel>Share on</ShareLabel>
        <SocialGrid>
          <SocialBtn
            href={twitterUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            Twitter
          </SocialBtn>
          <SocialBtn
            href={telegramUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
            </svg>
            Telegram
          </SocialBtn>
          <SocialBtn
            onClick={() => {
              navigator.clipboard.writeText(shareMessage)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Discord
          </SocialBtn>
        </SocialGrid>

        <MessagePreview>
          <strong style={{ color: 'rgba(255,255,255,0.65)' }}>Preview:</strong>
          <br />
          {shareMessage}
        </MessagePreview>
      </Modal>
    </Overlay>
  )
}

export default ShareModal
