import React, { useEffect, useState } from 'react'
import { useLocation, useParams, useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import PnLChart from '../components/PnLChart'
import CopyModal from '../../copytrade/CopyModal'
import { IdeaComment, LeaderFollower, Trader } from '../types'
import { Tooltip } from 'components/bases/tooltip'
import { useSDK } from '../../../context/SDKContext'
import socialApi, {
  buildCommentIdeaMessage,
  buildFollowLeaderMessage,
  buildLikeIdeaMessage,
  buildUnfollowLeaderMessage,
  buildUnlikeIdeaMessage,
  createSignedActionMetadata,
} from '../../../services/socialService'

// ── SVG Icons ──
const ArrowLeftIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
const UsersIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
const ChartIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
const WalletIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12V7H5a2 2 0 010-4h14v4" /><path d="M3 5v14a2 2 0 002 2h16v-5" /><path d="M18 12a2 2 0 100 4 2 2 0 000-4z" /></svg>
const BarChartIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
const ListIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
const IdeaIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18h6" /><path d="M10 22h4" /><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0018 8 6 6 0 006 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 019 14" /></svg>
const ShareIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>
const HeartIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>
const MessageIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
const TwitterIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26l8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
const TelegramIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 10l-4 4l6 6l4 -16l-18 7l4 2l2 6l3 -4" /></svg>
const DiscordIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 12a1 1 0 1 0 2 0a1 1 0 0 0 -2 0" /><path d="M14 12a1 1 0 1 0 2 0a1 1 0 0 0 -2 0" /><path d="M15.5 17c0 1 1.5 3 2 3c1.5 0 2.833 -1.667 3.5 -3c.667 -1.667 .5 -5.833 -1.5 -11.5c-1.457 -1.015 -3 -1.34 -4.5 -1.5l-1 2.5a16.989 16.989 0 0 0 -6 0l-1 -2.5c-1.5 .16 -3.043 .485 -4.5 1.5c-2 5.667 -2.167 9.833 -1.5 11.5c.667 1.333 2 3 3.5 3c.5 0 2 -2 2 -3" /><path d="M7 16.5c3.5 1 6.5 1 10 0" /></svg>

// ── Styled ──

const Page = styled.div`
  min-height: 100vh;
  background: #1A1A1A;
  padding-top: 64px;
`

const BackBtn = styled.button`
  background: transparent;
  border: none;
  color: #8A8A8E;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  cursor: pointer;
  padding: 16px 24px;
  display: flex;
  align-items: center;
  gap: 8px;
  &:hover { color: #FFFFFF; }
`

const CoverBanner = styled.div<{ isAI?: boolean }>`
  height: 160px;
  background: ${({ isAI }) =>
    isAI
      ? 'linear-gradient(135deg, #1B0A7A 0%, #291193 30%, #1A1A1A 100%)'
      : 'linear-gradient(135deg, #3C1CB7 0%, #291193 30%, #1A1A1A 100%)'};
  position: relative;
`

const ProfileSection = styled.div`
  max-width: 900px;
  margin: 0 auto;
  padding: 0 24px;
  position: relative;
  margin-top: -48px;
`

const AvatarLarge = styled.div<{ isAI?: boolean }>`
  width: 96px;
  height: 96px;
  border-radius: 50%;
  border: 4px solid #1A1A1A;
  background: ${({ isAI }) =>
    isAI
      ? 'linear-gradient(135deg, #6C38FF, #3C1CB7)'
      : 'linear-gradient(135deg, #5228DB, #291193)'};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  color: #fff;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  overflow: hidden;
`

const AvatarImage = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`

const ProfileInfo = styled.div`
  margin-top: 16px;
`

const ProfileName = styled.h1`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 28px;
  font-weight: 800;
  color: #FFFFFF;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 12px;
`

const Badge = styled.span<{ color?: string }>`
  background: ${({ color }) => color || '#6C38FF'};
  color: #fff;
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  font-family: 'Space Grotesk', sans-serif;
`

const ProfileMeta = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  color: #8A8A8E;
  margin-top: 4px;
`

const ProfileBio = styled.p`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 15px;
  color: #8A8A8E;
  line-height: 1.6;
  margin: 16px 0;
  max-width: 600px;
`

const SocialLinksRow = styled.div`
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin: 0 0 18px;
`

const SocialLink = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid #2A2A2C;
  color: #FFFFFF;
  text-decoration: none;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  font-weight: 600;

  &:hover {
    background: #232323;
  }
`

const ProfileStats = styled.div`
  display: flex;
  gap: 24px;
  margin: 16px 0 24px;
  flex-wrap: wrap;
`

const PStat = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  color: #8A8A8E;

  span {
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 700;
    color: #FFFFFF;
    font-size: 16px;
  }
  small {
    color: #47474A;
    font-size: 13px;
    font-family: 'Space Grotesk', sans-serif;
  }
`

const ProfileActions = styled.div`
  display: flex;
  gap: 12px;
  margin-bottom: 32px;
`

const FollowersSection = styled.div`
  margin-bottom: 32px;
`

const FollowersHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  color: #FFFFFF;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  font-weight: 700;

  small {
    color: #47474A;
    font-size: 12px;
    font-weight: 500;
  }
`

const FollowersGrid = styled.div`
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
`

const FollowerChip = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #232323;
  border: 1px solid #2A2A2C;
`

const FollowerAvatar = styled.div`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #3C1CB7, #6C38FF);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #FFFFFF;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 11px;
  font-weight: 700;
`

const FollowerInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;

  strong {
    color: #FFFFFF;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 13px;
    font-weight: 700;
  }

  span {
    color: #8A8A8E;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 11px;
  }
`

const CopyBtn = styled.button`
  padding: 12px 32px;
  border-radius: 8px;
  background: #6C38FF;
  border: none;
  color: #FFFFFF;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 15px;
  cursor: pointer;
  &:hover { background: #5228DB; }
`

const SecondaryBtn = styled.button`
  padding: 12px 24px;
  border-radius: 8px;
  background: transparent;
  border: 1px solid #2A2A2C;
  color: #FFFFFF;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  &:hover { background: #232323; }
`

const Tabs = styled.div`
  display: flex;
  gap: 0;
  border-bottom: 1px solid #2A2A2C;
  margin-bottom: 32px;
`

const PTab = styled.button<{ active: boolean }>`
  padding: 16px 24px;
  border: none;
  background: transparent;
  color: ${({ active }) => active ? '#FFFFFF' : '#47474A'};
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  border-bottom: 2px solid ${({ active }) => active ? '#6C38FF' : 'transparent'};
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 8px;
  &:hover { color: #FFFFFF; }
`

const Content = styled.div`
  max-width: 900px;
  margin: 0 auto;
  padding: 0 24px 64px;
`

const ChartContainer = styled.div`
  background: #232323;
  border: 1px solid #2A2A2C;
  border-radius: 16px;
  padding: 24px;
  margin-bottom: 24px;
`

const ChartTitle = styled.h3`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 18px;
  color: #FFFFFF;
  margin: 0 0 16px 0;
`

const MetricsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 32px;
`

const MetricCard = styled.div`
  background: #232323;
  border: 1px solid #2A2A2C;
  border-radius: 12px;
  padding: 20px;
  text-align: center;
`

const MetricVal = styled.div<{ color?: string }>`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 24px;
  font-weight: 700;
  color: ${({ color }) => color || '#FFFFFF'};
`

const MetricLbl = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  color: #47474A;
  margin-top: 4px;
`

const TradesTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  background: #232323;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #2A2A2C;
`

const TTh = styled.th`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: #47474A;
  padding: 14px 16px;
  text-align: left;
  border-bottom: 1px solid #2A2A2C;
`

const TTd = styled.td<{ color?: string }>`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  color: ${({ color }) => color || '#FFFFFF'};
  padding: 14px 16px;
  border-bottom: 1px solid rgba(42,42,44,0.5);
`

const IdeaCard = styled.div`
  background: #232323;
  border: 1px solid #2A2A2C;
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 16px;
  transition: border-color 0.2s, box-shadow 0.2s;
  &:hover {
    border-color: #3A3A3C;
    box-shadow: 0 4px 24px rgba(0,0,0,0.3);
  }
`

const IdeaHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
`

const IdeaTitle = styled.h4`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 16px;
  color: #FFFFFF;
  margin: 0;
  flex: 1;
  word-break: break-word;
`

const DirectionBadge = styled.span<{ bullish: boolean }>`
  color: ${({ bullish }) => bullish ? '#26D07C' : '#FF284C'};
  font-size: 12px;
  font-weight: 700;
  font-family: 'Space Grotesk', sans-serif;
  background: ${({ bullish }) => bullish ? 'rgba(38,208,124,0.1)' : 'rgba(255,40,76,0.1)'};
  padding: 4px 10px;
  border-radius: 4px;
  flex-shrink: 0;
  margin-left: 12px;
`

const IdeaDesc = styled.p<{ expanded?: boolean }>`
  color: #8A8A8E;
  font-size: 14px;
  line-height: 1.6;
  margin: 8px 0 12px;
  font-family: 'Space Grotesk', sans-serif;
  word-break: break-word;
  ${({ expanded }) => !expanded && `
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
  `}
`

const ReadMoreBtn = styled.button`
  background: transparent;
  border: none;
  color: #6C38FF;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  margin-bottom: 12px;
  &:hover { color: #8B5CF6; }
`

const IdeaActions = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  padding-top: 12px;
  border-top: 1px solid rgba(42,42,44,0.5);
  margin-top: 12px;
`

const ActionButton = styled.button<{ active?: boolean; activeColor?: string }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 8px;
  border: none;
  background: ${({ active, activeColor }) => active ? `${activeColor || '#6C38FF'}12` : 'transparent'};
  color: ${({ active, activeColor }) => active ? (activeColor || '#6C38FF') : '#8A8A8E'};
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  &:hover {
    background: ${({ activeColor }) => `${activeColor || '#6C38FF'}12`};
    color: ${({ activeColor }) => activeColor || '#6C38FF'};
  }
  svg {
    transition: transform 0.2s;
  }
  &:active svg {
    transform: scale(1.3);
  }
`

const TagsRow = styled.div`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-left: auto;
`

const IdeaTag = styled.span`
  background: #2A2A2C;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  color: #8A8A8E;
  font-family: 'Space Grotesk', sans-serif;
`

const IdeaDateLabel = styled.span`
  font-size: 12px;
  color: #47474A;
  font-family: 'Space Grotesk', sans-serif;
  margin-left: auto;
`

const CommentsSection = styled.div`
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(42,42,44,0.3);
`

const CommentInputRow = styled.div`
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
`

const CommentInput = styled.input`
  flex: 1;
  background: #1A1A1A;
  border: 1px solid #2A2A2C;
  border-radius: 8px;
  padding: 10px 14px;
  color: #FFFFFF;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  outline: none;
  &:focus { border-color: #6C38FF; }
  &::placeholder { color: #47474A; }
`

const CommentSubmitBtn = styled.button`
  padding: 10px 18px;
  border-radius: 8px;
  background: #6C38FF;
  border: none;
  color: #FFFFFF;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  &:hover { background: #5228DB; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`

const CommentItem = styled.div`
  display: flex;
  gap: 10px;
  padding: 10px 0;
  &:not(:last-child) {
    border-bottom: 1px solid rgba(42,42,44,0.3);
  }
`

const CommentAvatar = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(135deg, #3C1CB7, #6C38FF);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
`

const CommentBody = styled.div`
  flex: 1;
  min-width: 0;
`

const CommentAuthor = styled.span`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  font-weight: 700;
  color: #FFFFFF;
`

const CommentTime = styled.span`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 11px;
  color: #47474A;
  margin-left: 8px;
`

const CommentText = styled.p`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  color: #8A8A8E;
  margin: 4px 0 0;
  line-height: 1.5;
`

const EmptyComments = styled.div`
  text-align: center;
  padding: 20px 0;
  color: #47474A;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
`

const EmptyState = styled.div`
  text-align: center;
  padding: 64px 0;
  color: #47474A;
  font-family: 'Space Grotesk', sans-serif;
`

// ── Helpers ──

const getInitials = (name: string): string => {
  return name.replace(/[^A-Za-z ]/g, '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

const formatRelativeTime = (value: string): string => {
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return value

  const diffMs = Date.now() - timestamp
  const diffMinutes = Math.max(Math.floor(diffMs / 60000), 0)

  if (diffMinutes < 1) return 'Just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays}d ago`

  return new Date(value).toLocaleDateString()
}

const isImageAvatar = (avatar?: string): boolean => {
  if (!avatar) return false
  return avatar.startsWith('data:image') || avatar.startsWith('http') || avatar.startsWith('/')
}

const getAvatarContent = (trader: Trader) => {
  if (isImageAvatar(trader.avatar)) {
    return <AvatarImage src={trader.avatar} alt={trader.name} />
  }

  if (trader.avatar && trader.avatar.length <= 4) {
    return trader.avatar
  }

  return getInitials(trader.name)
}

// ── Toast Component ──
const Toast = styled.div`
  position: fixed;
  bottom: 32px;
  right: 32px;
  background: #26D07C;
  color: #1A1A1A;
  padding: 12px 24px;
  border-radius: 8px;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 8px 32px rgba(38, 208, 124, 0.2);
  z-index: 10000;
  animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1), fadeOut 0.3s 2.7s forwards;

  @keyframes slideIn {
    from { transform: translateY(100%); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
  @keyframes fadeOut {
    to { opacity: 0; pointer-events: none; }
  }
`

// ── Component ──

interface ProfileLocationState {
  trader?: Trader
}

const Profile: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { walletAddress, connectWallet, signMessage } = useSDK()
  const [tab, setTab] = useState<'performance' | 'trades' | 'ideas'>('performance')
  const [showCopy, setShowCopy] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [followLoading, setFollowLoading] = useState(false)
  const [trader, setTrader] = useState<Trader | null>(null)

  // Idea interactions state
  const [likedIdeas, setLikedIdeas] = useState<Record<string, boolean>>({})
  const [ideaLikeCounts, setIdeaLikeCounts] = useState<Record<string, number>>({})
  const [expandedIdeas, setExpandedIdeas] = useState<Record<string, boolean>>({})
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({})
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({})
  const [ideaComments, setIdeaComments] = useState<Record<string, IdeaComment[]>>({})
  const [commentLoading, setCommentLoading] = useState<Record<string, boolean>>({})
  const [commentSubmittingId, setCommentSubmittingId] = useState<string | null>(null)
  const [leaderFollowers, setLeaderFollowers] = useState<LeaderFollower[]>([])

  useEffect(() => {
    const state = location.state as ProfileLocationState | null
    const passedTrader = state?.trader ?? null
    setTrader(passedTrader)

    if (!id) {
      setIsLoading(false)
      return
    }

    let isMounted = true

    const loadTrader = async () => {
      setIsLoading(true)

      try {
        const [nextTrader, nextFollowers] = await Promise.all([
          socialApi.getLeaderProfile(id, walletAddress ?? undefined),
          socialApi.getLeaderFollowers(id, 8),
        ])

        if (isMounted) {
          setTrader(nextTrader)
          setLeaderFollowers(nextFollowers)
          setIdeaLikeCounts(
            nextTrader.ideas.reduce<Record<string, number>>((acc, idea) => {
              acc[idea.id] = idea.likes
              return acc
            }, {})
          )
        }
      } catch {
        // Keep whatever was passed via navigation state, or null
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    void loadTrader()

    const intervalId = window.setInterval(() => {
      void loadTrader()
    }, 30000)

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
    }
  }, [id, location.state, walletAddress])

  const loadComments = async (ideaId: string) => {
    setCommentLoading(prev => ({ ...prev, [ideaId]: true }))

    try {
      const comments = await socialApi.getIdeaComments(ideaId, 50)
      setIdeaComments(prev => ({ ...prev, [ideaId]: comments }))
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load comments')
    } finally {
      setCommentLoading(prev => ({ ...prev, [ideaId]: false }))
    }
  }

  const showToast = (message: string) => {
    setToastMessage(message)
    setTimeout(() => setToastMessage(''), 3000)
  }

  const handleShareProfile = async () => {
    const url = window.location.href

    try {
      await navigator.clipboard.writeText(url)
      showToast('Profile link copied!')
    } catch {
      showToast('Failed to copy profile link')
    }
  }

  const handleFollow = async () => {
    if (!id || !trader) return

    if (!walletAddress) {
      try {
        await connectWallet()
        showToast('Wallet connected. Click follow again to continue.')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to connect wallet')
      }
      return
    }

    setFollowLoading(true)

    try {
      if (trader.isFollowing) {
        const auth = createSignedActionMetadata()
        const signature = await signMessage(buildUnfollowLeaderMessage({
          leaderId: id,
          address: walletAddress,
          nonce: auth.nonce,
          timestamp: auth.timestamp,
        }))

        await socialApi.unfollowLeader(id, {
          address: walletAddress,
          nonce: auth.nonce,
          timestamp: auth.timestamp,
          signature,
        })
        const followers = await socialApi.getLeaderFollowers(id, 8)
        setTrader({
          ...trader,
          isFollowing: false,
          followers: Math.max(trader.followers - 1, 0),
        })
        setLeaderFollowers(followers)
        showToast(`Stopped following ${trader.name}.`)
      } else {
        const auth = createSignedActionMetadata()
        const signature = await signMessage(buildFollowLeaderMessage({
          leaderId: id,
          address: walletAddress,
          nonce: auth.nonce,
          timestamp: auth.timestamp,
        }))

        await socialApi.followLeader(id, {
          address: walletAddress,
          nonce: auth.nonce,
          timestamp: auth.timestamp,
          signature,
        })
        const followers = await socialApi.getLeaderFollowers(id, 8)
        setTrader({
          ...trader,
          isFollowing: true,
          followers: trader.followers + 1,
        })
        setLeaderFollowers(followers)
        showToast(`Now following ${trader.name}.`)
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update follow state')
    } finally {
      setFollowLoading(false)
    }
  }

  if (isLoading && !trader) return <Page><Content><p style={{ color: '#fff' }}>Loading trader...</p></Content></Page>
  if (!trader) return <Page><Content><p style={{ color: '#fff' }}>Trader not found.</p></Content></Page>

  return (
    <Page>
      <BackBtn onClick={() => navigate('/social')}><ArrowLeftIcon /> Back to Social Trade</BackBtn>
      <CoverBanner isAI={trader.isAI} />

      <ProfileSection>
        <AvatarLarge isAI={trader.isAI}>{getAvatarContent(trader)}</AvatarLarge>
        <ProfileInfo>
          <ProfileName>
            {trader.name}
            {trader.isVerified && <Badge>Verified</Badge>}
            {trader.isAI && <Badge color="#3C1CB7">AI Agent</Badge>}
          </ProfileName>
          <ProfileMeta>@{trader.username} · Member since {trader.memberSince} · {trader.fee}% Performance Fee</ProfileMeta>
          <ProfileBio>{trader.bio}</ProfileBio>

          {!!(trader.socialLinks?.twitterUrl || trader.socialLinks?.telegramUrl || trader.socialLinks?.discordUrl) && (
            <SocialLinksRow>
              {trader.socialLinks?.twitterUrl && (
                <SocialLink href={trader.socialLinks.twitterUrl} target="_blank" rel="noreferrer">
                  <TwitterIcon /> X / Twitter
                </SocialLink>
              )}
              {trader.socialLinks?.telegramUrl && (
                <SocialLink href={trader.socialLinks.telegramUrl} target="_blank" rel="noreferrer">
                  <TelegramIcon /> Telegram
                </SocialLink>
              )}
              {trader.socialLinks?.discordUrl && (
                <SocialLink href={trader.socialLinks.discordUrl} target="_blank" rel="noreferrer">
                  <DiscordIcon /> Discord
                </SocialLink>
              )}
            </SocialLinksRow>
          )}

          <ProfileStats>
            <PStat><UsersIcon /><span>{trader.followers.toLocaleString()}</span><small>Followers</small></PStat>
            <PStat><ChartIcon /><span>{trader.winRate}%</span><small>Win Rate</small></PStat>
            <PStat>
              <WalletIcon />
              <span>{trader.aum} USDT</span>
              <small>
                AUM
                <Tooltip content="Assets Under Management: The total capital being managed by this Trader/Bot at the moment." />
              </small>
            </PStat>
            <PStat>
              <BarChartIcon />
              <span>{trader.sharpe}</span>
              <small>
                Sharpe
                <Tooltip content="The Sharpe Ratio measures risk-adjusted return. Values >1.0 are good, >2.0 are very good, and >3.0 are excellent." />
              </small>
            </PStat>
          </ProfileStats>

          <ProfileActions>
            <CopyBtn onClick={() => setShowCopy(true)}>Copy Trade</CopyBtn>
            <SecondaryBtn onClick={handleFollow} disabled={followLoading}>{followLoading ? 'Processing...' : trader.isFollowing ? 'Following' : 'Follow'}</SecondaryBtn>
            <SecondaryBtn onClick={handleShareProfile}><ShareIcon /> Share</SecondaryBtn>
          </ProfileActions>

          <FollowersSection>
            <FollowersHeader>
              <span>Latest followers</span>
              <small>{trader.followers.toLocaleString()} total</small>
            </FollowersHeader>
            <FollowersGrid>
              {leaderFollowers.length > 0 ? leaderFollowers.map((follower) => (
                <FollowerChip key={follower.id}>
                  <FollowerAvatar>{follower.initials}</FollowerAvatar>
                  <FollowerInfo>
                    <strong>{follower.name}</strong>
                    <span>{follower.username ? `@${String(follower.username)}` : formatRelativeTime(follower.followedAt)}</span>
                  </FollowerInfo>
                </FollowerChip>
              )) : (
                <FollowerChip>
                  <FollowerInfo>
                    <strong>No followers yet</strong>
                    <span>Follower data will appear here as the vault grows.</span>
                  </FollowerInfo>
                </FollowerChip>
              )}
            </FollowersGrid>
          </FollowersSection>
        </ProfileInfo>
      </ProfileSection>

      <Content>
        <Tabs>
          <PTab active={tab === 'performance'} onClick={() => setTab('performance')}><BarChartIcon /> Performance</PTab>
          <PTab active={tab === 'trades'} onClick={() => setTab('trades')}><ListIcon /> Trade History</PTab>
          <PTab active={tab === 'ideas'} onClick={() => setTab('ideas')}><IdeaIcon /> Ideas ({trader.ideas.length})</PTab>
        </Tabs>

        {tab === 'performance' && (
          <>
            <ChartContainer>
              <ChartTitle>PnL Performance (30 days)</ChartTitle>
              <PnLChart data={trader.pnlHistory} color="#6C38FF" height={200} />
            </ChartContainer>

            <MetricsGrid>
              <MetricCard>
                <MetricVal color="#26D07C">+{trader.roi30d}%</MetricVal>
                <MetricLbl>30d ROI</MetricLbl>
              </MetricCard>
              <MetricCard>
                <MetricVal color="#26D07C">+{trader.roi90d}%</MetricVal>
                <MetricLbl>90d ROI</MetricLbl>
              </MetricCard>
              <MetricCard>
                <MetricVal>{trader.winRate}%</MetricVal>
                <MetricLbl>Win Rate</MetricLbl>
              </MetricCard>
              <MetricCard>
                <MetricVal color="#FF284C">{trader.drawdown}%</MetricVal>
                <MetricLbl>
                  Max Drawdown
                  <Tooltip content="Maximum Drawdown: The largest historical drop from peak to trough." />
                </MetricLbl>
              </MetricCard>
            </MetricsGrid>
          </>
        )}

        {tab === 'trades' && (
          <TradesTable>
            <thead>
              <tr>
                <TTh>Date</TTh>
                <TTh>Pair</TTh>
                <TTh>Side</TTh>
                <TTh>Entry</TTh>
                <TTh>Exit</TTh>
                <TTh>PnL</TTh>
                <TTh>Status</TTh>
              </tr>
            </thead>
            <tbody>
              {trader.trades.map((t, i) => (
                <tr key={i}>
                  <TTd>{t.date}</TTd>
                  <TTd>{t.pair}</TTd>
                  <TTd color={t.side === 'Buy' ? '#26D07C' : '#FF284C'}>{t.side}</TTd>
                  <TTd>${t.entry.toLocaleString()}</TTd>
                  <TTd>${t.exit.toLocaleString()}</TTd>
                  <TTd color={t.pnl >= 0 ? '#26D07C' : '#FF284C'}>{t.pnl > 0 ? '+' : ''}{t.pnl}%</TTd>
                  <TTd>{t.status}</TTd>
                </tr>
              ))}
              {trader.trades.length === 0 && (
                <tr><TTd colSpan={7} style={{ textAlign: 'center', color: '#47474A' }}>No trades yet.</TTd></tr>
              )}
            </tbody>
          </TradesTable>
        )}

        {tab === 'ideas' && (
          trader.ideas.length > 0 ? (
            trader.ideas.map(idea => {
              const isLiked = likedIdeas[idea.id] || false
              const currentLikes = ideaLikeCounts[idea.id] ?? idea.likes
              const isExpanded = expandedIdeas[idea.id] || false
              const showCommentSection = openComments[idea.id] || false
              const comments = ideaComments[idea.id] || []
              const currentCommentsCount = ideaComments[idea.id] ? comments.length : idea.comments
              const commentInput = commentInputs[idea.id] || ''
              const isCommentsLoading = commentLoading[idea.id] || false

              const handleLike = async () => {
                if (!walletAddress) {
                  try {
                    await connectWallet()
                    showToast('Wallet connected. Click like again to continue.')
                  } catch (err) {
                    showToast(err instanceof Error ? err.message : 'Failed to connect wallet')
                  }
                  return
                }

                try {
                  const auth = createSignedActionMetadata()
                  const result = isLiked
                    ? await socialApi.unlikeIdea(idea.id, {
                      address: walletAddress,
                      nonce: auth.nonce,
                      timestamp: auth.timestamp,
                      signature: await signMessage(buildUnlikeIdeaMessage({
                        ideaId: idea.id,
                        address: walletAddress,
                        nonce: auth.nonce,
                        timestamp: auth.timestamp,
                      })),
                    })
                    : await socialApi.likeIdea(idea.id, {
                      address: walletAddress,
                      nonce: auth.nonce,
                      timestamp: auth.timestamp,
                      signature: await signMessage(buildLikeIdeaMessage({
                        ideaId: idea.id,
                        address: walletAddress,
                        nonce: auth.nonce,
                        timestamp: auth.timestamp,
                      })),
                    })

                  setLikedIdeas(prev => ({ ...prev, [idea.id]: !isLiked }))
                  setIdeaLikeCounts(prev => ({
                    ...prev,
                    [idea.id]: result.likes ?? (isLiked ? Math.max(currentLikes - 1, 0) : currentLikes + 1),
                  }))
                } catch (err) {
                  showToast(err instanceof Error ? err.message : 'Failed to update like')
                }
              }

              const handleToggleExpand = () => {
                setExpandedIdeas(prev => ({ ...prev, [idea.id]: !isExpanded }))
              }

              const handleToggleComments = async () => {
                const nextOpen = !showCommentSection
                setOpenComments(prev => ({ ...prev, [idea.id]: nextOpen }))

                if (nextOpen && !ideaComments[idea.id]) {
                  await loadComments(idea.id)
                }
              }

              const handleCommentSubmit = async () => {
                if (!commentInput.trim()) return

                if (!walletAddress) {
                  try {
                    await connectWallet()
                    showToast('Wallet connected. Click post again to continue.')
                  } catch (err) {
                    showToast(err instanceof Error ? err.message : 'Failed to connect wallet')
                  }
                  return
                }

                setCommentSubmittingId(idea.id)

                try {
                  const auth = createSignedActionMetadata()
                  const content = commentInput.trim()
                  const signature = await signMessage(buildCommentIdeaMessage({
                    ideaId: idea.id,
                    address: walletAddress,
                    content,
                    nonce: auth.nonce,
                    timestamp: auth.timestamp,
                  }))

                  const newComment = await socialApi.commentOnIdea(idea.id, {
                    address: walletAddress,
                    content,
                    nonce: auth.nonce,
                    timestamp: auth.timestamp,
                    signature,
                  })
                  setIdeaComments(prev => ({
                    ...prev,
                    [idea.id]: [newComment, ...(prev[idea.id] || [])],
                  }))
                  setCommentInputs(prev => ({ ...prev, [idea.id]: '' }))
                  showToast('Comment posted!')
                } catch (err) {
                  showToast(err instanceof Error ? err.message : 'Failed to post comment')
                } finally {
                  setCommentSubmittingId(null)
                }
              }

              const handleShare = () => {
                const url = `${window.location.origin}/social/idea/${idea.id}`
                navigator.clipboard.writeText(url)
                  .then(() => showToast('Link copied!'))
                  .catch(() => showToast('Failed to copy link'))
              }

              return (
                <IdeaCard key={idea.id}>
                  <IdeaHeader>
                    <IdeaTitle>{idea.title}</IdeaTitle>
                    <DirectionBadge bullish={idea.direction === 'Bullish'}>{idea.direction}</DirectionBadge>
                  </IdeaHeader>

                  <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    {idea.tags.map(t => <IdeaTag key={t}>{t}</IdeaTag>)}
                    <IdeaDateLabel>{idea.date}</IdeaDateLabel>
                  </div>

                  <IdeaDesc expanded={isExpanded}>{idea.description}</IdeaDesc>
                  {idea.description.length > 120 && (
                    <ReadMoreBtn onClick={handleToggleExpand}>
                      {isExpanded ? '▲ Show less' : '▼ Read more'}
                    </ReadMoreBtn>
                  )}

                  <IdeaActions>
                    <ActionButton
                      active={isLiked}
                      activeColor="#FF284C"
                      onClick={handleLike}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill={isLiked ? '#FF284C' : 'none'} stroke="currentColor" strokeWidth="2">
                        <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
                      </svg>
                      {currentLikes}
                    </ActionButton>

                    <ActionButton
                      active={showCommentSection}
                      activeColor="#3B82F6"
                      onClick={handleToggleComments}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                      </svg>
                      {currentCommentsCount}
                    </ActionButton>

                    <ActionButton onClick={handleShare}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                      </svg>
                      Share
                    </ActionButton>

                    <TagsRow>
                      <IdeaTag>{idea.pair}</IdeaTag>
                    </TagsRow>
                  </IdeaActions>

                  {showCommentSection && (
                    <CommentsSection>
                      <CommentInputRow>
                        <CommentInput
                          placeholder="Write a comment..."
                          value={commentInput}
                          onChange={e => setCommentInputs(prev => ({ ...prev, [idea.id]: e.target.value }))}
                          onKeyDown={async e => { if (e.key === 'Enter') await handleCommentSubmit() }}
                        />
                        <CommentSubmitBtn
                          disabled={!commentInput.trim() || commentSubmittingId === idea.id}
                          onClick={handleCommentSubmit}
                        >
                          {commentSubmittingId === idea.id ? 'Posting...' : 'Post'}
                        </CommentSubmitBtn>
                      </CommentInputRow>

                      {isCommentsLoading ? (
                        <EmptyComments>Loading comments...</EmptyComments>
                      ) : comments.length > 0 ? (
                        comments.map(c => (
                          <CommentItem key={c.id}>
                            <CommentAvatar>{c.initials}</CommentAvatar>
                            <CommentBody>
                              <CommentAuthor>{c.author}</CommentAuthor>
                              <CommentTime>{formatRelativeTime(c.createdAt)}</CommentTime>
                              <CommentText>{c.content}</CommentText>
                            </CommentBody>
                          </CommentItem>
                        ))
                      ) : (
                        <EmptyComments>No comments yet. Be the first!</EmptyComments>
                      )}
                    </CommentsSection>
                  )}
                </IdeaCard>
              )
            })
          ) : (
            <EmptyState>No ideas published yet.</EmptyState>
          )
        )}
      </Content>

      {showCopy && (
        <CopyModal
          trader={trader as any}
          onClose={() => setShowCopy(false)}
          onConfirm={(amount) => {
            const token = trader.vault?.collateralToken ?? 'USDT'
            setToastMessage(`Success! Deposited ${amount} ${token} into ${trader.name}'s Vault.`)
            setShowCopy(false)
            setTimeout(() => setToastMessage(''), 3000)
          }}
        />
      )}

      {toastMessage && (
        <Toast>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
          {toastMessage}
        </Toast>
      )}
    </Page>
  )
}

export default Profile
