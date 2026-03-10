import React from 'react'
import styled from 'styled-components'
import { useNavigate } from 'react-router-dom'

interface SettingsProps {
  close: () => void
}

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 999;
`

const MenuContainer = styled.div`
  position: fixed;
  top: 70px;
  right: 100px;
  background: ${({ theme }) => theme.colors.themeColors[500]};
  border-radius: 12px;
  padding: 8px 0;
  min-width: 220px;
  z-index: 1000;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  border: 1px solid ${({ theme }) => theme.colors.themeColors[400]};
`

const MenuItem = styled.div<{ $danger?: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  color: ${props => props.$danger ? '#ff6b6b' : '#fff'};
  font-size: 14px;
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: ${({ theme }) => theme.colors.themeColors[400]};
  }

  svg {
    width: 18px;
    height: 18px;
    opacity: 0.8;
  }
`

const Divider = styled.div`
  height: 1px;
  background: ${({ theme }) => theme.colors.themeColors[400]};
  margin: 8px 0;
`

const MenuTitle = styled.div`
  padding: 10px 20px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`

// Icons as SVG components
const AboutIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
)

const DocsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
)

const DiscordIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
  </svg>
)

const TwitterIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
)

const ListingIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="16" />
    <line x1="8" y1="12" x2="16" y2="12" />
  </svg>
)

const PoolsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <circle cx="12" cy="12" r="8" />
    <line x1="12" y1="4" x2="12" y2="1" />
    <line x1="12" y1="23" x2="12" y2="20" />
    <line x1="4" y1="12" x2="1" y2="12" />
    <line x1="23" y1="12" x2="20" y2="12" />
  </svg>
)

const ProfileIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
)

const TermsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </svg>
)

const LanguageIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
)

const Settings: React.FC<SettingsProps> = ({ close }) => {
  const navigate = useNavigate()

  const handleNavigation = (path: string) => {
    navigate(path)
    close()
  }

  const handleExternalLink = (url: string) => {
    window.open(url, '_blank')
    close()
  }

  return (
    <>
      <Overlay onClick={close} />
      <MenuContainer>
        <MenuTitle>Navigation</MenuTitle>
        
        <MenuItem onClick={() => handleNavigation('/pools')}>
          <PoolsIcon />
          Liquidity Pools
        </MenuItem>

        <MenuItem onClick={() => handleNavigation('/listing')}>
          <ListingIcon />
          Token Listing
        </MenuItem>

        <MenuItem onClick={() => handleNavigation('/social/settings')}>
          <ProfileIcon />
          Leader Profile Settings
        </MenuItem>

        <Divider />
        <MenuTitle>Resources</MenuTitle>

        <MenuItem onClick={() => handleNavigation('/docs')}>
          <DocsIcon />
          Developer Docs
        </MenuItem>

        <MenuItem onClick={() => handleExternalLink('https://lunes.io/about')}>
          <AboutIcon />
          About Lunex
        </MenuItem>

        <Divider />
        <MenuTitle>Community</MenuTitle>

        <MenuItem onClick={() => handleExternalLink('https://discord.gg/lunes')}>
          <DiscordIcon />
          Discord
        </MenuItem>

        <MenuItem onClick={() => handleExternalLink('https://twitter.com/LunesPlatform')}>
          <TwitterIcon />
          Twitter / X
        </MenuItem>

        <Divider />
        <MenuTitle>Settings</MenuTitle>

        <MenuItem onClick={() => {}}>
          <LanguageIcon />
          Language: English
        </MenuItem>

        <MenuItem onClick={() => handleExternalLink('https://lunes.io/terms')}>
          <TermsIcon />
          Terms & Service
        </MenuItem>
      </MenuContainer>
    </>
  )
}

export default Settings
