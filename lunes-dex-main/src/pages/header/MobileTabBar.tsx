import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Activity,
  ArrowRightLeft,
  Droplet,
  Ellipsis,
  Layers,
  LucideIcon
} from 'lucide-react'
import { C, grotesk } from 'components/ui/kit'
import { Dialog } from 'components/ui/Dialog'
import { useIsMobile } from 'hooks/useMediaQuery'
import { MORE_NAV, activePrimary, inMore, isActive } from './nav'

const Bar = styled.nav`
  position: sticky;
  bottom: 0;
  z-index: 30;
  flex-shrink: 0;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  background: ${C.surface};
  border-top: 1px solid ${C.border};
  padding: 6px 4px calc(10px + env(safe-area-inset-bottom, 0px));
`

const Tab = styled.button<{ $active: boolean }>`
  height: 52px;
  border: none;
  background: transparent;
  color: ${p => (p.$active ? C.text : C.muted)};
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  transition: color 150ms ease;
`

const SheetGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
`

const SheetItem = styled.button<{ $active: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 14px;
  border: 1px solid ${p => (p.$active ? C.primary : C.border)};
  border-radius: 14px;
  background: ${p => (p.$active ? 'rgba(108,56,255,0.12)' : C.bg)};
  color: ${C.text};
  text-align: left;
  b {
    ${grotesk};
    font-weight: 600;
    font-size: 15px;
  }
  span {
    font-size: 12px;
    color: ${C.muted};
  }
`

const TABS: { key: string; label: string; to: string; Icon: LucideIcon }[] = [
  { key: 'swap', label: 'Swap', to: '/swap', Icon: ArrowRightLeft },
  { key: 'pools', label: 'Pools', to: '/pools', Icon: Droplet },
  { key: 'staking', label: 'Stake', to: '/staking', Icon: Layers },
  { key: 'activity', label: 'Activity', to: '/activity', Icon: Activity }
]

/** Mobile (<760) 5-tab bottom bar + 2-column "More" bottom sheet. */
const MobileTabBar: React.FC = () => {
  const mobile = useIsMobile()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => {
    setMoreOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!mobile) setMoreOpen(false)
  }, [mobile])

  if (!mobile) return null

  const primary = activePrimary(pathname)
  const more = inMore(pathname)

  return (
    <>
      <Bar aria-label="Main">
        {TABS.map(({ key, label, to, Icon }) => (
          <Tab
            key={key}
            $active={primary === key}
            aria-current={primary === key ? 'page' : undefined}
            onClick={() => navigate(to)}
          >
            <Icon size={20} strokeWidth={1.75} />
            {label}
          </Tab>
        ))}
        <Tab
          $active={more || moreOpen}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(o => !o)}
        >
          <Ellipsis size={20} strokeWidth={1.75} />
          More
        </Tab>
      </Bar>

      <Dialog
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        ariaLabel="More"
        hideClose
        padding={12}
      >
        <SheetGrid>
          {MORE_NAV.map(m => {
            const active = isActive(m, pathname)
            return (
              <SheetItem
                key={m.key}
                $active={active}
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  setMoreOpen(false)
                  navigate(m.to)
                }}
              >
                <b>{m.label}</b>
                <span>{m.note}</span>
              </SheetItem>
            )
          })}
        </SheetGrid>
      </Dialog>
    </>
  )
}

export default MobileTabBar
