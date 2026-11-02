import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import { Camera } from 'lucide-react'
import {
  Button,
  C,
  Card,
  H1,
  Input,
  Notice,
  Page,
  Sub,
  Textarea,
  grotesk,
  tabular
} from 'components/ui/kit'
import { useSDK } from '../../../context/SDKContext'
import { useTx } from '../../../context/TxContext'
import { useToast } from '../../../components/feedback/ToastProvider'
import socialApi, {
  buildUpsertLeaderProfileMessage,
  createSignedActionMetadata,
  UpsertLeaderProfileInput
} from '../../../services/socialService'
import { Trader } from '../types'
import {
  AIBadge,
  BackToSocial,
  fmtCount,
  handle,
  TraderAvatar
} from '../shared'
import { requestWalletConnect } from 'pages/header/modals/wallets'

const Layout = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-start;
`

const FormCol = styled.div`
  flex: 1.4 1 360px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
`

const PreviewCol = styled.aside`
  flex: 1 1 280px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  position: sticky;
  top: 88px;
  min-width: 0;
  @media (max-width: 759px) {
    position: static;
  }
`

const Block = styled(Card)`
  padding: 18px;
  gap: 12px;
`

const BlockTitle = styled.h2`
  ${grotesk};
  font-weight: 600;
  font-size: 15px;
`

const FieldLabel = styled.label`
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: ${C.muted};
`

const Counter = styled.span`
  align-self: flex-end;
  font-size: 11px;
  color: ${C.muted};
  ${tabular};
`

const TwoCol = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
`

const SliderHead = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  span:first-child {
    color: ${C.muted};
  }
  span:last-child {
    font-weight: 600;
    ${tabular};
  }
`

const Range = styled.input.attrs({ type: 'range' })`
  width: 100%;
  accent-color: ${C.primary};
`

const AvatarRow = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 12px;
  color: ${C.muted};
`

const PreviewCard = styled(Card)`
  padding: 16px;
  gap: 14px;
`

const PrevName = styled.span`
  ${grotesk};
  font-weight: 600;
  font-size: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const FakeCta = styled.div`
  height: 44px;
  border-radius: 12px;
  background: ${C.primary};
  display: flex;
  align-items: center;
  justify-content: center;
  ${grotesk};
  font-weight: 600;
  font-size: 14px;
`

const NAME_MAX = 32
const USER_MAX = 16
const BIO_MAX = 160

const SocialSettings: React.FC = () => {
  const navigate = useNavigate()
  const { walletAddress, signMessage } = useSDK()
  const tx = useTx()
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [bio, setBio] = useState('')
  const [fee, setFee] = useState(15)
  // PLACEHOLDER: no backend yet — the profile API has no minimum-deposit
  // field; the value is only shown in the preview and not submitted.
  const [minDeposit, setMinDeposit] = useState('100')
  const [twitter, setTwitter] = useState('')
  const [telegram, setTelegram] = useState('')
  const [discord, setDiscord] = useState('')
  const [avatar, setAvatar] = useState('')
  const [saved, setSaved] = useState<Trader | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [loadNote, setLoadNote] = useState<{
    tone: 'primary' | 'critical'
    text: string
  } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    if (!walletAddress) {
      setSaved(null)
      setLoadNote(null)
      return
    }
    setLoadingProfile(true)
    setLoadNote(null)
    socialApi
      .getLeaderProfileByAddress(walletAddress, walletAddress)
      .then(t => {
        if (!alive) return
        setSaved(t)
        setName(t.name)
        setUsername(t.username)
        setBio(t.bio)
        setFee(t.fee)
        setTwitter(t.socialLinks?.twitterUrl || '')
        setTelegram(t.socialLinks?.telegramUrl || '')
        setDiscord(t.socialLinks?.discordUrl || '')
        setAvatar(t.avatar || '')
        if (t.vault?.minDeposit) setMinDeposit(String(t.vault.minDeposit))
      })
      .catch((err: unknown) => {
        if (!alive) return
        const msg =
          err instanceof Error ? err.message : 'Could not load profile'
        setSaved(null)
        setLoadNote(
          msg.toLowerCase().includes('not found')
            ? {
                tone: 'primary',
                text: 'No trader profile yet. Fill in the form to create one.'
              }
            : { tone: 'critical', text: msg }
        )
      })
      .finally(() => alive && setLoadingProfile(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress])

  const onAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file?.type?.startsWith('image/')) return
    if (file.size > 1024 * 1024) {
      toast('warning', 'Image too large', 'Pick an image under 1 MB.')
      return
    }
    const img = new Image()
    img.onload = () => {
      const MAX = 400
      let { width, height } = img
      if (width > MAX || height > MAX) {
        const r = Math.min(MAX / width, MAX / height)
        width = Math.round(width * r)
        height = Math.round(height * r)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')?.drawImage(img, 0, 0, width, height)
      setAvatar(canvas.toDataURL('image/jpeg', 0.8))
      URL.revokeObjectURL(img.src)
    }
    img.src = URL.createObjectURL(file)
  }

  const missing = !name.trim()
    ? 'Enter a display name'
    : !username.trim()
      ? 'Enter a username'
      : !bio.trim()
        ? 'Add a short bio'
        : null

  const save = () => {
    if (!walletAddress) {
      setBusy(true)
      requestWalletConnect()
        .catch((err: unknown) =>
          toast(
            'error',
            'Wallet not connected',
            err instanceof Error ? err.message : undefined
          )
        )
        .finally(() => setBusy(false))
      return
    }
    if (missing) return
    const address = walletAddress
    let payload: UpsertLeaderProfileInput
    let result: Trader | null = null
    const displayName = name.trim()
    tx.run({
      type: 'social',
      title: 'Saving profile',
      summary: `${displayName} · fee ${fee}%`,
      actTitle: 'Update trader profile',
      successTitle: 'Profile saved',
      steps: [
        {
          label: 'Sign profile update',
          wallet: true,
          run: async () => {
            const auth = createSignedActionMetadata()
            payload = {
              address,
              name: displayName,
              username: username.trim().replace(/^@/, ''),
              bio: bio.trim(),
              avatar,
              fee,
              twitterUrl: twitter.trim(),
              telegramUrl: telegram.trim(),
              discordUrl: discord.trim(),
              nonce: auth.nonce,
              timestamp: auth.timestamp,
              signature: ''
            }
            payload.signature = await signMessage(
              buildUpsertLeaderProfileMessage(payload)
            )
            return true
          }
        },
        {
          label: 'Waiting for block confirmation',
          run: async () => {
            result = await socialApi.upsertLeaderProfile(payload)
            return true
          }
        }
      ],
      onSuccess: () => {
        const t = result as Trader | null
        if (!t) return
        setSaved(t)
        if (t.avatar) setAvatar(t.avatar)
        navigate(`/social/profile/${t.id}`, { state: { trader: t } })
      }
    })
  }

  const ctaLabel = !walletAddress
    ? busy
      ? 'Connecting…'
      : 'Connect wallet'
    : (missing ?? (saved ? 'Save profile' : 'Publish profile'))
  const ctaOk = !walletAddress ? !busy : !missing

  const feeMax = Math.max(30, saved?.fee ?? 0)
  const prevName = name.trim() || 'Your trader name'
  const prevUser = handle(username.trim()) || '@handle'
  const prevMin = Number(minDeposit) > 0 ? `$${Number(minDeposit)}` : '—'

  return (
    <Page $max={1000} style={{ gap: 16 }}>
      <BackToSocial />
      <div>
        <H1>Trader profile settings</H1>
        <Sub style={{ fontSize: 15 }}>
          How you appear to copiers on Social Trade and in the vault
          marketplace.
        </Sub>
      </div>

      {!walletAddress && (
        <Notice $tone="primary">
          Connect your wallet to load or create your trader profile.
        </Notice>
      )}
      {loadingProfile && (
        <Notice $tone="neutral">Loading your trader profile…</Notice>
      )}
      {loadNote && <Notice $tone={loadNote.tone}>{loadNote.text}</Notice>}

      <Layout>
        <FormCol>
          <Block>
            <BlockTitle>Basic information</BlockTitle>
            <AvatarRow>
              <TraderAvatar
                name={prevName}
                avatar={avatar}
                ai={saved?.isAI}
                size={56}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                >
                  <Camera size={14} /> Upload avatar
                </Button>
                <span>JPG, GIF or PNG · 1 MB max</span>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={onAvatar}
              />
            </AvatarRow>
            <FieldLabel>
              Display name
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your trader name"
                maxLength={NAME_MAX}
              />
            </FieldLabel>
            <FieldLabel>
              Username
              <Input
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="@handle"
                maxLength={USER_MAX + 1}
              />
            </FieldLabel>
            <FieldLabel>
              Bio
              <Textarea
                value={bio}
                onChange={e => setBio(e.target.value)}
                placeholder="Your strategy in one or two sentences"
                rows={3}
                maxLength={BIO_MAX}
              />
              <Counter>
                {bio.length}/{BIO_MAX}
              </Counter>
            </FieldLabel>
          </Block>

          <Block>
            <BlockTitle>Trading vault configuration</BlockTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <SliderHead>
                <span>Performance fee</span>
                <span>{fee}%</span>
              </SliderHead>
              <Range
                min={5}
                max={feeMax}
                step={1}
                value={fee}
                onChange={e => setFee(Number(e.target.value))}
                aria-label="Performance fee"
              />
              <span style={{ fontSize: 12, color: C.muted }}>
                Charged only on profits above the high-water mark.
              </span>
            </div>
            <FieldLabel>
              Minimum deposit (LUSDT)
              <Input
                value={minDeposit}
                onChange={e => {
                  const v = e.target.value
                  if (/^\d*\.?\d*$/.test(v)) setMinDeposit(v)
                }}
                placeholder="100"
                inputMode="decimal"
              />
            </FieldLabel>
          </Block>

          <Block>
            <BlockTitle>Social links</BlockTitle>
            <TwoCol>
              <FieldLabel>
                X / Twitter
                <Input
                  value={twitter}
                  onChange={e => setTwitter(e.target.value)}
                  placeholder="https://x.com/handle"
                />
              </FieldLabel>
              <FieldLabel>
                Telegram
                <Input
                  value={telegram}
                  onChange={e => setTelegram(e.target.value)}
                  placeholder="https://t.me/…"
                />
              </FieldLabel>
              <FieldLabel>
                Discord
                <Input
                  value={discord}
                  onChange={e => setDiscord(e.target.value)}
                  placeholder="https://discord.gg/…"
                />
              </FieldLabel>
            </TwoCol>
          </Block>

          <Button size="xl" block disabled={!ctaOk} onClick={save}>
            {ctaLabel}
          </Button>
        </FormCol>

        <PreviewCol aria-label="Live card preview">
          <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>
            Live card preview
          </span>
          <PreviewCard>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <TraderAvatar name={prevName} avatar={avatar} ai={saved?.isAI} />
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  minWidth: 0
                }}
              >
                <PrevName>
                  {prevName}
                  {saved?.isAI && <AIBadge />}
                </PrevName>
                <span style={{ fontSize: 12, color: C.muted }}>
                  {prevUser} · {fmtCount(saved?.followers ?? 0)} copiers
                </span>
              </div>
            </div>
            <span
              style={{
                fontSize: 13,
                color: C.secondary,
                lineHeight: 1.5,
                wordBreak: 'break-word'
              }}
            >
              {bio.trim() || 'Your strategy in one or two sentences.'}
            </span>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 12
              }}
            >
              <span style={{ color: C.muted }}>
                Perf. fee{' '}
                <b className="num" style={{ color: '#fff' }}>
                  {fee}%
                </b>
              </span>
              <span style={{ color: C.muted }}>
                Min.{' '}
                <b className="num" style={{ color: '#fff' }}>
                  {prevMin}
                </b>
              </span>
            </div>
            <FakeCta aria-hidden="true">Copy trader</FakeCta>
          </PreviewCard>
          <span style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
            Publishing links your profile to a copy vault. Followers deposit
            into the vault contract — you never hold their funds.
          </span>
        </PreviewCol>
      </Layout>
    </Page>
  )
}

export default SocialSettings
