import React from 'react'
import styled from 'styled-components'
import { BadgeCheck } from 'lucide-react'
import { Button, C, grotesk, tabular } from 'components/ui/kit'
import { AnimatedNumber } from 'components/ui/AnimatedNumber'
import { Trader } from './types'
import {
  AIBadge,
  aumLabel,
  fmtCount,
  fmtPct,
  handle,
  MiniStat,
  roiColor,
  Sparkline,
  TraderAvatar
} from './shared'

export const TraderGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
  gap: 12px;
`

export const CardShell = styled.article`
  border: 1px solid ${C.border};
  border-radius: 16px;
  background: ${C.surface};
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  transition: border-color 200ms ease;
  &:hover {
    border-color: ${C.borderStrong};
  }
`

const Head = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
`

const Names = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const Name = styled.span`
  ${grotesk};
  font-weight: 600;
  font-size: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  > span:first-child {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`

const Meta = styled.span`
  font-size: 12px;
  color: ${C.muted};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  ${tabular};
`

const RoiRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 12px;
`

const RoiValue = styled.span<{ $color: string }>`
  ${grotesk};
  ${tabular};
  font-size: 28px;
  font-weight: 600;
  line-height: 1.15;
  color: ${p => p.$color};
`

const Stats = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
`

const Bio = styled.p`
  font-size: 13px;
  color: ${C.secondary};
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`

export interface TraderCardProps {
  trader: Pick<
    Trader,
    | 'id'
    | 'name'
    | 'username'
    | 'avatar'
    | 'isAI'
    | 'isVerified'
    | 'followers'
    | 'roi30d'
    | 'pnlHistory'
    | 'winRate'
    | 'sharpe'
    | 'aum'
  > & { bio?: string }
  /** Label when the viewer already copies this trader ("Copying · $X — stop"). */
  copyingLabel?: string
  onProfile?: () => void
  onCopy?: () => void
  /** Live preview in settings: buttons are inert, bio is shown. */
  preview?: boolean
  footer?: React.ReactNode
}

const TraderCard: React.FC<TraderCardProps> = ({
  trader: t,
  copyingLabel,
  onProfile,
  onCopy,
  preview,
  footer
}) => {
  const color = roiColor(t.roi30d)
  return (
    <CardShell aria-label={t.name}>
      <Head>
        <TraderAvatar name={t.name} avatar={t.avatar} ai={t.isAI} />
        <Names>
          <Name>
            <span>{t.name}</span>
            {t.isAI && <AIBadge />}
            {t.isVerified && (
              <BadgeCheck
                size={15}
                color={C.primaryText}
                aria-label="Verified"
              />
            )}
          </Name>
          <Meta>
            {handle(t.username)} · {fmtCount(t.followers)} copiers
          </Meta>
        </Names>
      </Head>

      {preview && t.bio ? <Bio>{t.bio}</Bio> : null}

      <RoiRow>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 12, color: C.muted }}>ROI 30d</span>
          <RoiValue $color={color}>
            <AnimatedNumber text={fmtPct(t.roi30d)} />
          </RoiValue>
        </div>
        <Sparkline data={t.pnlHistory} color={color} />
      </RoiRow>

      <Stats>
        <MiniStat>
          <span>Win rate</span>
          <AnimatedNumber text={`${(t.winRate ?? 0).toFixed(0)}%`} />
        </MiniStat>
        <MiniStat>
          <span>Sharpe</span>
          <AnimatedNumber text={(t.sharpe ?? 0).toFixed(1)} />
        </MiniStat>
        <MiniStat>
          <span>AUM</span>
          <AnimatedNumber text={aumLabel(t.aum)} />
        </MiniStat>
      </Stats>

      {footer}

      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          variant="secondary"
          size="lg"
          style={{ height: 44 }}
          onClick={onProfile}
          tabIndex={preview ? -1 : undefined}
          aria-disabled={preview || undefined}
        >
          Profile
        </Button>
        <Button
          variant={copyingLabel ? 'secondary' : 'primary'}
          size="lg"
          style={{ height: 44, flex: 1 }}
          onClick={onCopy}
          tabIndex={preview ? -1 : undefined}
          aria-disabled={preview || undefined}
        >
          {copyingLabel ?? 'Copy trader'}
        </Button>
      </div>
    </CardShell>
  )
}

export default TraderCard
