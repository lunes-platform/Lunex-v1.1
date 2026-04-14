import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import TraderCard from '../components/TraderCard'
import { Trader } from '../types'
import { useSDK } from '../../../context/SDKContext'
import socialApi, {
  buildUpsertLeaderProfileMessage,
  createSignedActionMetadata
} from '../../../services/socialService'

// ── SVG Icons ──
const ArrowLeftIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
)
const CameraIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
)
const TwitterIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M4 4l11.733 16h4.267l-11.733 -16z" />
    <path d="M4 20l6.768 -6.768m2.46 -2.46l6.772 -6.772" />
  </svg>
)
const TelegramIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M15 10l-4 4l6 6l4 -16l-18 7l4 2l2 6l3 -4" />
  </svg>
)
const DiscordIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M8 12a1 1 0 1 0 2 0a1 1 0 0 0 -2 0" />
    <path d="M14 12a1 1 0 1 0 2 0a1 1 0 0 0 -2 0" />
    <path d="M15.5 17c0 1 1.5 3 2 3c1.5 0 2.833 -1.667 3.5 -3c.667 -1.667 .5 -5.833 -1.5 -11.5c-1.457 -1.015 -3 -1.34 -4.5 -1.5l-1 2.5a16.989 16.989 0 0 0 -6 0l-1 -2.5c-1.5 .16 -3.043 .485 -4.5 1.5c-2 5.667 -2.167 9.833 -1.5 11.5c.667 1.333 2 3 3.5 3c.5 0 2 -2 2 -3" />
    <path d="M7 16.5c3.5 1 6.5 1 10 0" />
  </svg>
)

// ── Styled Components ──

const Page = styled.div`
  min-height: 100vh;
  background: #1a1a1a;
  padding: 80px 24px 64px;
`

const Container = styled.div`
  max-width: 1200px;
  margin: 0 auto;
`

const HeaderRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 40px;
`

const BackBtn = styled.button`
  background: transparent;
  border: none;
  color: #8a8a8e;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  &:hover {
    color: #ffffff;
  }
`

const PageTitle = styled.h1`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 32px;
  font-weight: 800;
  color: #ffffff;
  margin: 16px 0 0 0;
  letter-spacing: -0.5px;
`

const PageDesc = styled.p`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 16px;
  color: #8a8a8e;
  margin: 8px 0 0 0;
`

const MainGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 400px;
  gap: 48px;
  align-items: start;

  @media (max-width: 960px) {
    grid-template-columns: 1fr;
  }
`

const FormSection = styled.div`
  background: #232323;
  border: 1px solid #2a2a2c;
  border-radius: 16px;
  padding: 32px;
  display: flex;
  flex-direction: column;
  gap: 32px;
`

const FormBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const SectionTitle = styled.h3`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 18px;
  font-weight: 700;
  color: #ffffff;
  margin: 0;
  border-bottom: 1px solid #2a2a2c;
  padding-bottom: 12px;
`

const InputGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const Label = styled.label`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: #8a8a8e;
`

const Input = styled.input`
  background: #1a1a1a;
  border: 1px solid #2a2a2c;
  border-radius: 8px;
  padding: 12px 16px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  color: #ffffff;
  outline: none;
  transition: all 0.2s;

  &::placeholder {
    color: #47474a;
  }
  &:focus {
    border-color: #6c38ff;
    background: #111;
  }
`

const TextArea = styled.textarea`
  background: #1a1a1a;
  border: 1px solid #2a2a2c;
  border-radius: 8px;
  padding: 12px 16px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  color: #ffffff;
  outline: none;
  resize: vertical;
  min-height: 100px;
  transition: all 0.2s;

  &::placeholder {
    color: #47474a;
  }
  &:focus {
    border-color: #6c38ff;
    background: #111;
  }
`

const SocialInputWrapper = styled.div`
  position: relative;
  display: flex;
  align-items: center;

  svg {
    position: absolute;
    left: 14px;
    color: #8a8a8e;
  }

  input {
    padding-left: 42px;
  }
`

const AvatarUploadArea = styled.div`
  display: flex;
  align-items: center;
  gap: 24px;
`

const AvatarPreview = styled.div`
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6c38ff, #3c1cb7);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  color: #fff;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  border: 2px solid #2a2a2c;
  overflow: hidden;
`

const AvatarImage = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`

const UploadBtn = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  background: #2a2a2c;
  border: 1px solid #47474a;
  color: #ffffff;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  font-weight: 600;
  padding: 10px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: #47474a;
  }
`

const HiddenFileInput = styled.input`
  display: none;
`

const FeeSliderContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`

const FeeSlider = styled.input`
  flex: 1;
  accent-color: #6c38ff;
`

const FeeValue = styled.div`
  background: #1a1a1a;
  border: 1px solid #2a2a2c;
  padding: 8px 16px;
  border-radius: 6px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  font-weight: 700;
  color: #26d07c;
  min-width: 60px;
  text-align: center;
`

const SaveBtn = styled.button`
  background: #6c38ff;
  color: #ffffff;
  border: none;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 15px;
  font-weight: 700;
  padding: 14px 24px;
  border-radius: 8px;
  width: 100%;
  cursor: pointer;
  transition: all 0.2s;
  margin-top: 16px;

  &:hover {
    background: #5228db;
    transform: translateY(-1px);
  }
  &:active {
    transform: translateY(1px);
  }
`

const PreviewSection = styled.div`
  position: sticky;
  top: 100px;
`

const PreviewTitle = styled.h3`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: #8a8a8e;
  margin: 0 0 16px 0;
  text-transform: uppercase;
  letter-spacing: 1px;
`

const InfoBox = styled.div`
  background: rgba(38, 208, 124, 0.1);
  border: 1px solid rgba(38, 208, 124, 0.2);
  color: #26d07c;
  padding: 16px;
  border-radius: 12px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  line-height: 1.5;
  margin-top: 24px;
`

const StatusText = styled.p<{ $error?: boolean; $success?: boolean }>`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  margin: 0;
  color: ${({ $error, $success }) => {
    if ($error) return '#FF6B6B'
    if ($success) return '#26D07C'
    return '#8A8A8E'
  }};
`

// ── Component ──

const SocialSettings: React.FC = () => {
  const navigate = useNavigate()
  const { walletAddress, connectWallet, signMessage } = useSDK()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [bio, setBio] = useState('')
  const [fee, setFee] = useState(15)
  const [twitter, setTwitter] = useState('')
  const [telegram, setTelegram] = useState('')
  const [discord, setDiscord] = useState('')
  const [avatarPreview, setAvatarPreview] = useState('')
  const [savedTrader, setSavedTrader] = useState<Trader | null>(null)
  const [isLoadingProfile, setIsLoadingProfile] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const getInitials = (n: string) => {
    if (!n) return '?'
    return n
      .replace(/[^A-Za-z ]/g, '')
      .split(' ')
      .map(w => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()
  }

  useEffect(() => {
    let isMounted = true

    const loadProfile = async () => {
      if (!walletAddress) {
        if (isMounted) {
          setSavedTrader(null)
          setStatusMessage(
            'Connect your wallet to load your saved leader profile.'
          )
        }
        return
      }

      if (isMounted) {
        setIsLoadingProfile(true)
        setErrorMessage('')
        setStatusMessage('Loading your leader profile...')
      }

      try {
        const trader = await socialApi.getLeaderProfileByAddress(
          walletAddress,
          walletAddress,
          signMessage
        )

        if (!isMounted) return

        setSavedTrader(trader)
        setName(trader.name)
        setUsername(trader.username)
        setBio(trader.bio)
        setFee(trader.fee)
        setTwitter(trader.socialLinks?.twitterUrl || '')
        setTelegram(trader.socialLinks?.telegramUrl || '')
        setDiscord(trader.socialLinks?.discordUrl || '')
        setAvatarPreview(trader.avatar || '')
        setStatusMessage('Leader profile loaded from database.')
      } catch (err) {
        if (!isMounted) return

        const message =
          err instanceof Error ? err.message : 'Failed to load leader profile'
        setSavedTrader(null)

        if (message.toLowerCase().includes('not found')) {
          setStatusMessage(
            'No leader profile found yet. Fill the form to create one.'
          )
        } else {
          setErrorMessage(message)
        }
      } finally {
        if (isMounted) setIsLoadingProfile(false)
      }
    }

    void loadProfile()

    return () => {
      isMounted = false
    }
  }, [walletAddress])

  const baseTrader = savedTrader

  const previewTrader: Trader = {
    id: baseTrader?.id || 'preview',
    name: name || baseTrader?.name || 'Your Name',
    username: username || baseTrader?.username || 'username',
    address: walletAddress || 'Wallet not connected',
    avatar:
      avatarPreview ||
      baseTrader?.avatar ||
      getInitials(name || baseTrader?.name || 'Your Name'),
    isAI: baseTrader?.isAI || false,
    isVerified: baseTrader?.isVerified || false,
    bio:
      bio ||
      baseTrader?.bio ||
      'Share your trading strategy, background, and what followers can expect by copying your vault.',
    memberSince: baseTrader?.memberSince || 'Today',
    roi30d: baseTrader?.roi30d || 0,
    roi90d: baseTrader?.roi90d || 0,
    aum: baseTrader?.aum || '0',
    drawdown: baseTrader?.drawdown || 0,
    followers: baseTrader?.followers || 0,
    winRate: baseTrader?.winRate || 0,
    avgProfit: baseTrader?.avgProfit || 0,
    sharpe: 0,
    fee: fee,
    pnlHistory: baseTrader?.pnlHistory || [0, 0, 0, 0, 0, 0, 0],
    trades: baseTrader?.trades || [],
    ideas: baseTrader?.ideas || [],
    tags: baseTrader?.tags || ['New Leader'],
    socialLinks: {
      twitterUrl: twitter,
      telegramUrl: telegram,
      discordUrl: discord
    },
    isFollowing: baseTrader?.isFollowing,
    vault: baseTrader?.vault
  }

  const handleAvatarSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file?.type?.startsWith('image/')) {
      return
    }

    const img = new Image()
    img.onload = () => {
      const MAX = 400
      let { width, height } = img
      if (width > MAX || height > MAX) {
        const ratio = Math.min(MAX / width, MAX / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx?.drawImage(img, 0, 0, width, height)
      const compressed = canvas.toDataURL('image/jpeg', 0.8)
      setAvatarPreview(compressed)
      URL.revokeObjectURL(img.src)
    }
    img.src = URL.createObjectURL(file)
  }

  const handleSave = async () => {
    setErrorMessage('')
    setStatusMessage('')

    if (!walletAddress) {
      try {
        await connectWallet()
        setStatusMessage(
          'Wallet connected. Click save again to publish your profile.'
        )
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : 'Failed to connect wallet'
        )
      }
      return
    }

    if (!name.trim() || !username.trim() || !bio.trim()) {
      setErrorMessage('Display name, username, and biography are required.')
      return
    }

    setIsSaving(true)

    try {
      const auth = createSignedActionMetadata()
      const payload = {
        address: walletAddress,
        name: name.trim(),
        username: username.trim(),
        bio: bio.trim(),
        avatar: avatarPreview,
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

      const trader = await socialApi.upsertLeaderProfile({
        ...payload
      })

      setSavedTrader(trader)
      setAvatarPreview(trader.avatar || avatarPreview)
      setStatusMessage(
        'Leader profile saved successfully and synced with the backend.'
      )
      navigate(`/social/profile/${trader.id}`, { state: { trader } })
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to save leader profile'
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Page>
      <Container>
        <HeaderRow>
          <div>
            <BackBtn onClick={() => navigate('/social')}>
              <ArrowLeftIcon /> Back to Social Trade
            </BackBtn>
            <PageTitle>Trader Profile Settings</PageTitle>
            <PageDesc>
              Set up your Leader profile to allow other users to copy your
              trades and earn performance fees.
            </PageDesc>
          </div>
        </HeaderRow>

        {(isLoadingProfile || statusMessage || errorMessage) && (
          <div
            style={{
              marginBottom: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}
          >
            {isLoadingProfile && (
              <StatusText>Loading leader profile from backend...</StatusText>
            )}
            {!!statusMessage && (
              <StatusText $success={!isLoadingProfile}>
                {statusMessage}
              </StatusText>
            )}
            {!!errorMessage && <StatusText $error>{errorMessage}</StatusText>}
          </div>
        )}

        <MainGrid>
          <FormSection>
            <FormBlock>
              <SectionTitle>Basic Information</SectionTitle>

              <AvatarUploadArea>
                <AvatarPreview>
                  {avatarPreview ? (
                    <AvatarImage src={avatarPreview} alt="Avatar preview" />
                  ) : (
                    getInitials(previewTrader.name)
                  )}
                </AvatarPreview>
                <div>
                  <UploadBtn
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <CameraIcon /> Upload Avatar
                  </UploadBtn>
                  <HiddenFileInput
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarSelect}
                  />
                  <p
                    style={{
                      margin: '8px 0 0 0',
                      fontSize: '12px',
                      color: '#47474A',
                      fontFamily: 'Space Grotesk'
                    }}
                  >
                    JPG, GIF or PNG. 1MB max.
                  </p>
                </div>
              </AvatarUploadArea>

              <InputGroup>
                <Label>Display Name</Label>
                <Input
                  placeholder="e.g. LeandroSander"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  maxLength={32}
                />
              </InputGroup>

              <InputGroup>
                <Label>Username</Label>
                <Input
                  placeholder="e.g. leandrosander"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  maxLength={16}
                />
              </InputGroup>

              <InputGroup>
                <Label>Biography & Strategy</Label>
                <TextArea
                  placeholder="Describe your trading style, time horizon, and risk management approach..."
                  value={bio}
                  onChange={e => setBio(e.target.value)}
                  maxLength={160}
                />
              </InputGroup>
            </FormBlock>

            <FormBlock>
              <SectionTitle>Trading Vault Configuration</SectionTitle>

              <InputGroup>
                <Label>Performance Fee (%)</Label>
                <p
                  style={{
                    margin: '0 0 8px 0',
                    fontSize: '13px',
                    color: '#47474A',
                    fontFamily: 'Space Grotesk'
                  }}
                >
                  The percentage of profitable trades you will receive from your
                  copiers.
                </p>
                <FeeSliderContainer>
                  <FeeSlider
                    type="range"
                    min="5"
                    max="50"
                    draggable
                    value={fee}
                    onChange={e => setFee(Number(e.target.value))}
                  />
                  <FeeValue>{fee}%</FeeValue>
                </FeeSliderContainer>
              </InputGroup>
            </FormBlock>

            <FormBlock>
              <SectionTitle>Social Links</SectionTitle>

              <InputGroup>
                <Label>X (Twitter)</Label>
                <SocialInputWrapper>
                  <TwitterIcon />
                  <Input
                    style={{ width: '100%' }}
                    placeholder="https://x.com/username"
                    value={twitter}
                    onChange={e => setTwitter(e.target.value)}
                  />
                </SocialInputWrapper>
              </InputGroup>

              <InputGroup>
                <Label>Telegram Channel</Label>
                <SocialInputWrapper>
                  <TelegramIcon />
                  <Input
                    style={{ width: '100%' }}
                    placeholder="https://t.me/channel"
                    value={telegram}
                    onChange={e => setTelegram(e.target.value)}
                  />
                </SocialInputWrapper>
              </InputGroup>

              <InputGroup>
                <Label>Discord Server</Label>
                <SocialInputWrapper>
                  <DiscordIcon />
                  <Input
                    style={{ width: '100%' }}
                    placeholder="https://discord.gg/invite"
                    value={discord}
                    onChange={e => setDiscord(e.target.value)}
                  />
                </SocialInputWrapper>
              </InputGroup>
            </FormBlock>

            <SaveBtn onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving Profile...' : 'Save & Publish Leader Profile'}
            </SaveBtn>
          </FormSection>

          <PreviewSection>
            <PreviewTitle>Live Card Preview</PreviewTitle>
            <TraderCard
              trader={previewTrader}
              rank={99}
              onCopy={() => alert('Profile preview mode - copying disabled')}
            />

            <InfoBox>
              <strong>Vault Creation Note:</strong>
              <br />
              <br />
              By publishing your profile, an isolated Vault smart contract will
              be created on the Lunes Blockchain linked to your trading API
              keys. Followers will deposit their collateral strictly into this
              contract, keeping their funds non-custodial and secure.
            </InfoBox>
          </PreviewSection>
        </MainGrid>
      </Container>
    </Page>
  )
}

export default SocialSettings
