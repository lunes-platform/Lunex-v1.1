import React from 'react'
import styled from 'styled-components'
import { Button, C, Spinner } from '../ui/kit'
import { useReadSession } from '../../hooks/useReadSession'

const Box = styled.div<{ $compact?: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: ${p => (p.$compact ? '12px' : '24px 16px')};
  text-align: center;
  color: ${C.muted};
  font-size: 13px;
`

const Err = styled.span`
  color: ${C.criticalText};
  font-size: 12px;
`

/**
 * Fallback shown when the user has no read session (declined at connect,
 * expired, or revoked). One click = one wallet signature for 8 hours of
 * private reads. Never prompts on its own.
 */
export function ReadSessionPrompt({
  message = 'Sign in to view your private data',
  compact,
  onSignedIn
}: {
  message?: string
  compact?: boolean
  onSignedIn?: () => void
}) {
  const { address, signIn, signingIn, error } = useReadSession()
  if (!address) return null

  return (
    <Box $compact={compact} data-testid="read-session-prompt">
      <span>{message}</span>
      <Button
        size="sm"
        variant="primary"
        disabled={signingIn}
        onClick={async () => {
          if (await signIn()) onSignedIn?.()
        }}
      >
        {signingIn ? <Spinner $size={14} /> : null}
        Sign in to Lunex
      </Button>
      {error ? <Err>{error}</Err> : null}
    </Box>
  )
}
