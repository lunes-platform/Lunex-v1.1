/**
 * /faucet — get testnet tokens (non-mainnet builds only).
 *
 * Talks to the standalone faucet service at REACT_APP_FAUCET_URL; Turnstile
 * site key from REACT_APP_TURNSTILE_SITE_KEY (falls back to the one the
 * faucet advertises in /faucet/config). Amounts shown come from the faucet's
 * own config — nothing is hard-coded here.
 */
import React, { useEffect, useRef, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useSDK } from '../../context/SDKContext'
import { NETWORK } from '../../config/contracts'
import {
  Button,
  Card,
  Col,
  H1,
  Input,
  Label,
  Muted,
  Notice,
  Page,
  Sub
} from '../../components/ui/kit'
import {
  FAUCET_URL,
  TURNSTILE_SITE_KEY,
  fetchFaucetConfig,
  looksLikeLunesAddress,
  requestDrip,
  type DripResult,
  type FaucetConfig
} from './faucetClient'
import { Turnstile, type TurnstileHandle } from './Turnstile'

const fmtWait = (ms?: number) => {
  if (!ms) return ''
  const m = Math.ceil(ms / 60000)
  return m >= 60 ? ` (${Math.floor(m / 60)}h ${m % 60}m)` : ` (${m}m)`
}

export const FaucetPage: React.FC<{ network?: string; faucetUrl?: string }> = ({
  network = NETWORK.name,
  faucetUrl = FAUCET_URL
}) => {
  const { walletAddress } = useSDK()
  const [address, setAddress] = useState(walletAddress ?? '')
  const [config, setConfig] = useState<FaucetConfig | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<DripResult | null>(null)
  const [captchaError, setCaptchaError] = useState(false)
  const widget = useRef<TurnstileHandle>(null)

  useEffect(() => {
    if (walletAddress && !address) setAddress(walletAddress)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress])

  useEffect(() => {
    if (network === 'mainnet') return
    let alive = true
    fetchFaucetConfig(faucetUrl).then(c => alive && setConfig(c))
    return () => {
      alive = false
    }
  }, [network, faucetUrl])

  if (network === 'mainnet') {
    return (
      <Page $max={640}>
        <H1>Faucet</H1>
        <Notice $tone="neutral">The faucet is only available on testnet.</Notice>
      </Page>
    )
  }

  const siteKey = TURNSTILE_SITE_KEY || config?.captcha.siteKey || ''
  const captchaRequired = config ? config.captcha.required : Boolean(siteKey)
  const canSubmit =
    Boolean(faucetUrl) &&
    looksLikeLunesAddress(address) &&
    (!captchaRequired || Boolean(token)) &&
    !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setResult(null)
    const r = await requestDrip({ address, captchaToken: token ?? undefined }, faucetUrl)
    setResult(r)
    setBusy(false)
    widget.current?.reset() // a Turnstile token is single-use
  }

  const perRequest = config
    ? [
        `${config.native.amount} ${config.native.symbol}`,
        ...config.tokens.map(t => `${t.amount} ${t.symbol}`)
      ].join(' · ')
    : null

  return (
    <Page $max={640}>
      <Helmet>
        <title>Faucet — Lunex testnet</title>
      </Helmet>
      <div>
        <H1>Testnet faucet</H1>
        <Sub>
          Free test tokens to try Lunex on the Lunes testnet. They have no
          monetary value and balances may be reset at any time.
        </Sub>
      </div>

      {!faucetUrl && (
        <Notice $tone="warning" role="alert">
          The faucet is not configured for this deployment (REACT_APP_FAUCET_URL).
        </Notice>
      )}

      <Card $pad={20}>
        <Col $gap={12}>
          {perRequest && (
            <Muted $size={13}>
              Per request: <strong>{perRequest}</strong>
              {config && ` · cooldown ${Math.round(config.cooldownMinutes / 60)}h per address`}
            </Muted>
          )}
          <Label htmlFor="faucet-address">Lunes address</Label>
          <Input
            id="faucet-address"
            value={address}
            placeholder="5…"
            autoComplete="off"
            spellCheck={false}
            onChange={e => setAddress(e.target.value)}
          />
          {captchaRequired && siteKey && (
            <Turnstile
              ref={widget}
              siteKey={siteKey}
              onToken={setToken}
              onError={() => setCaptchaError(true)}
            />
          )}
          {captchaError && (
            <Notice $tone="warning">
              The captcha could not be loaded. Disable blockers for
              challenges.cloudflare.com and reload.
            </Notice>
          )}
          <Button block disabled={!canSubmit} onClick={submit}>
            {busy ? 'Sending… (waiting for finalization)' : 'Request test tokens'}
          </Button>
          {result?.kind === 'success' && (
            <Notice $tone="success" role="status">
              Sent {result.sent.map(s => `${s.amount} ${s.symbol}`).join(', ')}
              {result.skipped.length > 0 &&
                ` — not available right now: ${result.skipped.map(s => s.symbol).join(', ')}`}
              . Finalized in block {result.blockHash.slice(0, 12)}….
            </Notice>
          )}
          {result?.kind === 'pending' && (
            <Notice $tone="warning" role="status">
              {result.message}
            </Notice>
          )}
          {result?.kind === 'error' && (
            <Notice $tone="critical" role="alert">
              {result.message}
              {fmtWait(result.retryAfterMs)}
            </Notice>
          )}
        </Col>
      </Card>
    </Page>
  )
}

export default FaucetPage
