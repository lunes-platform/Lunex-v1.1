import React from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import PnLChart from '../PnLChart'
import { Trader } from '../../types'
import { Tooltip } from 'components/bases/tooltip'
import {
  interactiveCard,
  interactiveButton,
  timing,
  easing
} from '../../../../styles/motion'

// ── SVG Icons ──
const UsersIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 00-3-3.87" />
    <path d="M16 3.13a4 4 0 010 7.75" />
  </svg>
)
const ChartIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
)
const BotIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <rect x="3" y="11" width="18" height="10" rx="2" />
    <circle cx="12" cy="5" r="2" />
    <path d="M12 7v4" />
    <line x1="8" y1="16" x2="8" y2="16" />
    <line x1="16" y1="16" x2="16" y2="16" />
  </svg>
)

// ── Styled Components ──

const Card = styled.div<{ rank: number }>`
  background: #232323;
  border: 1px solid #2a2a2c;
  border-radius: 16px;
  padding: 24px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  ${interactiveCard}

  ${({ rank }) =>
    rank <= 3 &&
    `
    border-color: ${
      rank === 1 ? '#FFD70033' : rank === 2 ? '#C0C0C033' : '#CD7F3233'
    };
  `}
`

const RankBadge = styled.div<{ rank: number }>`
  position: absolute;
  top: 16px;
  right: 16px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  font-family: 'Space Grotesk', sans-serif;
  background: ${({ rank }) => {
    if (rank === 1) return 'linear-gradient(135deg, #FFD700, #FFA500)'
    if (rank === 2) return 'linear-gradient(135deg, #C0C0C0, #808080)'
    if (rank === 3) return 'linear-gradient(135deg, #CD7F32, #8B4513)'
    return '#2A2A2C'
  }};
  color: ${({ rank }) => (rank <= 3 ? '#000' : '#8A8A8E')};
`

const TopRow = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
`

const Avatar = styled.div<{ isAI?: boolean }>`
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: ${({ isAI }) =>
    isAI
      ? 'linear-gradient(135deg, #6C38FF 0%, #3C1CB7 100%)'
      : 'linear-gradient(135deg, #5228DB 0%, #291193 100%)'};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  flex-shrink: 0;
  color: #fff;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  overflow: hidden;
  transition: transform ${timing.normal} ${easing.spring};

  ${Card}:hover & {
    transform: scale(1.05);
  }
`

const AvatarImage = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`

const Info = styled.div`
  flex: 1;
  min-width: 0;
`

const Name = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 18px;
  font-weight: 700;
  color: #ffffff;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`

const Username = styled.div`
  font-size: 13px;
  color: #8a8a8e;
  font-family: 'Space Grotesk', sans-serif;
`

const Tag = styled.span<{ variant?: string }>`
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-family: 'Space Grotesk', sans-serif;
  display: inline-flex;
  align-items: center;
  gap: 4px;

  ${({ variant }) => {
    switch (variant) {
      case 'ai':
        return 'background: rgba(108,56,255,0.15); color: #AD87FF;'
      case 'top':
        return 'background: rgba(255,215,0,0.12); color: #FFD700;'
      case 'verified':
        return 'background: rgba(108,56,255,0.1); color: #CAAFFF;'
      case 'new':
        return 'background: rgba(254,95,0,0.1); color: #FE923F;'
      default:
        return 'background: #2A2A2C; color: #8A8A8E;'
    }
  }}
`

const Bio = styled.p`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  color: #8a8a8e;
  line-height: 1.5;
  margin: 0 0 16px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
`

const ChartArea = styled.div`
  margin: 0 -24px;
  padding: 0;
`

const MetricsRow = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin: 16px 0;
`

const Metric = styled.div`
  text-align: center;
`

const MetricValue = styled.div<{ positive?: boolean }>`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 16px;
  font-weight: 700;
  color: ${({ positive }) =>
    positive === undefined ? '#FFFFFF' : positive ? '#26D07C' : '#FF284C'};
`

const MetricLabel = styled.div`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 11px;
  color: #47474a;
  margin-top: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
`

const SecondaryMetrics = styled.div`
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  margin-top: 4px;
`

const SecMetric = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  color: #47474a;

  strong {
    color: rgba(255, 255, 255, 0.7);
    font-weight: 600;
  }
`

const Actions = styled.div`
  display: flex;
  gap: 12px;
  margin-top: 16px;
`

const ViewProfileBtn = styled.button`
  flex: 1;
  padding: 10px;
  border-radius: 8px;
  background: #2a2a2c;
  border: 1px solid #47474a;
  color: #ffffff;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  ${interactiveButton}

  &:hover:not(:disabled) {
    background: #47474a;
  }
`

const CopyBtn = styled.button`
  flex: 1;
  padding: 10px;
  border-radius: 8px;
  background: #6c38ff;
  border: none;
  color: #ffffff;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  ${interactiveButton}

  &:hover:not(:disabled) {
    background: #5228db;
  }
`

// ── Component ──

interface TraderCardProps {
  trader: Trader
  rank: number
  onCopy: (trader: Trader) => void
}

const getTagVariant = (tag: string): string => {
  if (tag === 'AI Agent') return 'ai'
  if (tag.includes('Top')) return 'top'
  if (tag === 'Verified') return 'verified'
  if (tag === 'New') return 'new'
  return ''
}

const getInitials = (name: string): string => {
  return name
    .replace(/[^A-Za-z ]/g, '')
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

const isImageAvatar = (avatar?: string): boolean => {
  if (!avatar) return false
  return (
    avatar.startsWith('data:image') ||
    avatar.startsWith('http') ||
    avatar.startsWith('/')
  )
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

const TraderCard: React.FC<TraderCardProps> = ({ trader, rank, onCopy }) => {
  const navigate = useNavigate()

  return (
    <Card rank={rank}>
      <RankBadge rank={rank}>#{rank}</RankBadge>

      <TopRow>
        <Avatar isAI={trader.isAI}>{getAvatarContent(trader)}</Avatar>
        <Info>
          <Name>
            {trader.name}
            {trader.tags.map(tag => (
              <Tag key={tag} variant={getTagVariant(tag)}>
                {tag === 'AI Agent' && <BotIcon />}
                {tag}
              </Tag>
            ))}
          </Name>
          <Username>
            @{trader.username} · Since {trader.memberSince} · {trader.fee}% Fee
          </Username>
        </Info>
      </TopRow>

      <Bio>{trader.bio}</Bio>

      <ChartArea>
        <PnLChart
          data={trader.pnlHistory}
          color={trader.roi30d >= 0 ? '#26D07C' : '#FF284C'}
          height={56}
        />
      </ChartArea>

      <MetricsRow>
        <Metric>
          <MetricValue positive={trader.roi30d >= 0}>
            {trader.roi30d > 0 ? '+' : ''}
            {trader.roi30d}%
          </MetricValue>
          <MetricLabel>
            <ChartIcon /> 30d ROI
          </MetricLabel>
        </Metric>
        <Metric>
          <MetricValue>{trader.aum}</MetricValue>
          <MetricLabel>
            AUM
            <Tooltip content="Assets Under Management: total capital in this vault from followers + trader." />
          </MetricLabel>
        </Metric>
        <Metric>
          <MetricValue positive={false}>
            {trader.drawdown.toFixed(1)}%
          </MetricValue>
          <MetricLabel>
            Max DD
            <Tooltip content="Maximum Drawdown: largest peak-to-trough drop. Lower = less risky." />
          </MetricLabel>
        </Metric>
        <Metric>
          <MetricValue>
            <UsersIcon /> {trader.followers}
          </MetricValue>
          <MetricLabel>Followers</MetricLabel>
        </Metric>
      </MetricsRow>

      <SecondaryMetrics>
        <SecMetric>
          Win Rate{' '}
          <strong>
            {trader.winRate > 0 ? `${trader.winRate.toFixed(1)}%` : '—'}
          </strong>
        </SecMetric>
        <SecMetric>
          Sharpe{' '}
          <strong
            style={{
              color:
                trader.sharpe > 1
                  ? '#26D07C'
                  : trader.sharpe > 0
                    ? '#FFA500'
                    : '#8A8A8E'
            }}
          >
            {trader.sharpe !== 0 ? trader.sharpe.toFixed(2) : '—'}
          </strong>
        </SecMetric>
        <SecMetric>
          90d ROI{' '}
          <strong
            style={{
              color:
                trader.roi90d > 0
                  ? '#26D07C'
                  : trader.roi90d < 0
                    ? '#FF284C'
                    : '#8A8A8E'
            }}
          >
            {trader.roi90d !== 0
              ? `${trader.roi90d > 0 ? '+' : ''}${trader.roi90d.toFixed(1)}%`
              : '—'}
          </strong>
        </SecMetric>
      </SecondaryMetrics>

      <Actions>
        <ViewProfileBtn
          onClick={() =>
            navigate(`/social/profile/${trader.id}`, { state: { trader } })
          }
        >
          View Profile
        </ViewProfileBtn>
        <CopyBtn onClick={() => onCopy(trader)}>Copy Trade</CopyBtn>
      </Actions>
    </Card>
  )
}

export default TraderCard
