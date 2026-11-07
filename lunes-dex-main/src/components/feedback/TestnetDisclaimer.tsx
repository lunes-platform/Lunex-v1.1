/**
 * First-visit testnet disclaimer (P1-6). Shown once per browser on any
 * non-mainnet build until the tester accepts it; acceptance is stored in
 * localStorage under a versioned key (bump the version when the text changes
 * materially). Storage failures (private mode, blocked site data) never block
 * the app: the dialog can still be accepted, it just shows again next visit.
 */
import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import Dialog from '../ui/Dialog'
import { Button, C } from '../ui/kit'
import { NETWORK } from '../../config/contracts'

export const DISCLAIMER_KEY = 'lunex-testnet-disclaimer-v1'

const readAccepted = (): boolean => {
  try {
    return localStorage.getItem(DISCLAIMER_KEY) !== null
  } catch {
    return false
  }
}

const storeAccepted = () => {
  try {
    localStorage.setItem(DISCLAIMER_KEY, new Date().toISOString())
  } catch {
    /* storage unavailable — accepted for this page view only */
  }
}

const List = styled.ul`
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 14px;
  line-height: 1.5;
  color: ${C.body};
`

const Check = styled.label`
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 13px;
  color: ${C.body};
  cursor: pointer;
  input {
    margin-top: 2px;
  }
`

type Props = { network?: string }

export const TestnetDisclaimer: React.FC<Props> = ({
  network = NETWORK.name
}) => {
  const [open, setOpen] = useState(false)
  const [agree, setAgree] = useState(false)

  useEffect(() => {
    if (network !== 'mainnet' && !readAccepted()) setOpen(true)
  }, [network])

  if (network === 'mainnet') return null

  const accept = () => {
    storeAccepted()
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onClose={() => undefined}
      locked
      hideClose
      role="alertdialog"
      title="Lunex community beta — testnet"
      description="Please read before you continue."
      width={520}
      zIndex={80}
    >
      <List>
        <li>
          This is a <strong>test network</strong>. LUNES, LUSDT, LBTC, LETH
          and every other token here are <strong>test tokens with no
          monetary value</strong>. They cannot be sold, redeemed or exchanged
          for real assets.
        </li>
        <li>
          Balances, orders, positions and history <strong>may be reset at
          any time</strong> without notice.
        </li>
        <li>
          The software is experimental and may contain bugs. Use a wallet
          account dedicated to testing, never one that holds real funds.
        </li>
        <li>
          Prices, volumes and yields shown here only reflect testnet activity.
          Nothing in this app is <strong>financial, investment or legal
          advice</strong>, nor a promise of returns.
        </li>
      </List>
      <Check>
        <input
          type="checkbox"
          checked={agree}
          onChange={e => setAgree(e.target.checked)}
          aria-label="I understand"
        />
        I understand that this is a testnet, tokens have no value and data may
        be reset.
      </Check>
      <Button block disabled={!agree} onClick={accept}>
        Enter the beta
      </Button>
    </Dialog>
  )
}

export default TestnetDisclaimer
