import React, { useState } from 'react'
import styled from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { C } from 'components/ui/kit'
import { useToast } from 'components/feedback/ToastProvider'
import { SETTINGS_GROUPS, MenuLink } from '../nav'
import { MenuItem, Popover } from '../styles'

/** Persisted UI preferences (read by other screens if they want to). */
export const LANG_KEY = 'lunex_lang'
export const SLIPPAGE_KEY = 'lunex_default_slippage'
const SLIPPAGE_OPTS = [0.1, 0.5, 1]

const read = (k: string, d: string) => {
  try {
    return localStorage.getItem(k) ?? d
  } catch {
    return d
  }
}
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    // storage unavailable
  }
}

const Group = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
`

const GroupTitle = styled.span`
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: ${C.muted};
  padding: 6px 10px 4px;
`

const Item = styled(MenuItem)`
  font-family: 'Inter', sans-serif;
  padding: 9px 10px;
`

const SettingsBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px 6px;
  border-top: 1px solid ${C.border};
`

const SetRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
`

const Seg = styled.div`
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: ${C.bg};
`

const SegBtn = styled.button<{ $active: boolean }>`
  height: 26px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: ${p => (p.$active ? C.field : 'transparent')};
  color: ${p => (p.$active ? C.text : C.muted)};
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
`

const SettingsMenu: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [lang, setLang] = useState(() => read(LANG_KEY, 'EN'))
  const [slip, setSlip] = useState(() => Number(read(SLIPPAGE_KEY, '0.5')))

  const open = (l: MenuLink) => {
    if (l.soon) {
      toast('info', `${l.label} coming soon`)
      return
    }
    if (l.href) window.open(l.href, '_blank', 'noopener,noreferrer')
    else if (l.to) navigate(l.to)
    onClose()
  }

  const pickLang = (k: string) => {
    setLang(k)
    write(LANG_KEY, k)
    // PLACEHOLDER: no i18n yet — the interface stays in English.
    if (k === 'PT')
      toast('info', 'Português em breve', 'A interface continua em inglês.')
  }

  const pickSlip = (v: number) => {
    setSlip(v)
    write(SLIPPAGE_KEY, String(v))
  }

  return (
    <Popover
      $width={300}
      $pad={10}
      $mobileFixed
      role="menu"
      aria-label="Settings"
      style={{ gap: 4 }}
    >
      {SETTINGS_GROUPS.map(g => (
        <Group key={g.title} role="group" aria-label={g.title}>
          <GroupTitle>{g.title}</GroupTitle>
          {g.items.map(it => (
            <Item key={it.label} role="menuitem" onClick={() => open(it)}>
              {it.label}
              {(it.href || it.soon) && <span aria-hidden>↗</span>}
            </Item>
          ))}
        </Group>
      ))}
      <SettingsBlock>
        <GroupTitle style={{ padding: 0 }}>Settings</GroupTitle>
        <SetRow>
          <span>Language</span>
          <Seg role="radiogroup" aria-label="Language">
            {['EN', 'PT'].map(k => (
              <SegBtn
                key={k}
                role="radio"
                aria-checked={lang === k}
                $active={lang === k}
                onClick={() => pickLang(k)}
              >
                {k}
              </SegBtn>
            ))}
          </Seg>
        </SetRow>
        <SetRow>
          <span>Default slippage</span>
          <Seg role="radiogroup" aria-label="Default slippage">
            {SLIPPAGE_OPTS.map(v => (
              <SegBtn
                key={v}
                role="radio"
                aria-checked={slip === v}
                $active={slip === v}
                onClick={() => pickSlip(v)}
              >
                {v}%
              </SegBtn>
            ))}
          </Seg>
        </SetRow>
      </SettingsBlock>
    </Popover>
  )
}

export default SettingsMenu
