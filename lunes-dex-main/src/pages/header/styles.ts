import device from 'components/devices/devices'
import styled, { css } from 'styled-components'

type StyledProps = {
  isPending?: boolean
}

export const Header = styled.header`
  ${({ theme }) => css`
    width: 100%;
    height: 64px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    gap: 16px;
    background-color: ${theme.colors.themeColors[600] || '#0d0d0d'};
    position: fixed;
    z-index: 10;
    box-sizing: border-box;
    ${device.laptop} {
      padding: 0 16px;
    }
    ${device.mobileL} {
      position: initial;
    }
    > img {
      max-width: 100px;
      max-height: 22px;
      flex-shrink: 0;
    }
  `}
`

export const Nav = styled.nav`
  ${({ theme }) => css`
    gap: 8px;
    display: flex;
    align-items: center;
    flex-shrink: 0;
    ${device.laptop} {
      div {
        display: none;
      }
    }
    img:first-of-type {
      display: none;
      ${device.laptop} {
        display: flex;
      }
    }
    img {
      padding: 8px;
      cursor: pointer;
      :hover {
        transition: all 0.2s;
        transform: translateY(0.7px);
      }
      :active {
        transition: none;
        transform: translateY(0.7px);
      }
      ${device.laptop} {
        display: none;
      }
    }
  `}
`

export const Span = styled.span<StyledProps>`
  ${({ ...props }) => css`
    max-width: 140px;
    width: 100%;
    height: 100%;
    padding: 0 8px;
    font-size: 16px;
    font-weight: 400;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
    display: block;
    line-height: 40px;
    text-align: center;
    font-weight: ${props.theme.colors.themeColors[200]};
    background-color: ${props.theme.colors.themeColors[400]};
  `}
`

export const Status = styled(Span) <StyledProps>`
  ${({ ...props }) => css`
    cursor: pointer;
    max-width: none;
    font-weight: ${props.isPending ? 600 : 400};
    color: ${props.isPending
      ? props.theme.colors.warning[500]
      : props.theme.colors.themeColors[100]};
    background-color: ${props.isPending
      ? props.theme.colors.warning[100]
      : props.theme.colors.themeColors[800]};
    border-radius: 0 12px 12px 0;
  `}
`

// Navigation Links Container
export const NavLinks = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
  justify-content: center;

  @media (max-width: 1280px) {
    display: none;
  }
`

// Individual Navigation Link
type NavLinkProps = {
  active?: boolean
}

export const NavLink = styled.button<NavLinkProps>`
  ${({ theme, active }) => css`
    padding: 7px 12px;
    border: none;
    border-radius: 10px;
    cursor: pointer;
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 600;
    font-size: 13px;
    letter-spacing: 0.3px;
    transition: all 0.2s;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 4px;

    background: ${active ? theme.colors.themeColors[800] : 'transparent'};
    color: ${active ? theme.colors.themeColors[100] : theme.colors.themeColors[200]};

    &:hover {
      background: ${active ? theme.colors.themeColors[800] : theme.colors.themeColors[400]};
      color: ${theme.colors.themeColors[100]};
    }
  `}
`

// Dropdown "More" menu
export const DropdownContainer = styled.div`
  position: relative;
  display: inline-flex;

  &:hover > div {
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
  }
`

export const DropdownMenu = styled.div`
  position: absolute;
  top: 100%;
  right: 0;
  padding-top: 8px;
  opacity: 0;
  visibility: hidden;
  transform: translateY(-4px);
  transition: all 0.2s ease;
  z-index: 100;
`

export const DropdownContent = styled.div`
  ${({ theme }) => css`
    background: ${theme.colors.themeColors[600] || '#1a1a1a'};
    border: 1px solid ${theme.colors.themeColors[400] || '#2a2a2c'};
    border-radius: 12px;
    padding: 6px;
    min-width: 160px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  `}
`

type DropdownItemProps = {
  active?: boolean
}

export const DropdownItem = styled.button<DropdownItemProps>`
  ${({ theme, active }) => css`
    display: block;
    width: 100%;
    padding: 10px 14px;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 600;
    font-size: 13px;
    text-align: left;
    transition: all 0.15s;

    background: ${active ? theme.colors.themeColors[800] : 'transparent'};
    color: ${active ? theme.colors.themeColors[100] : theme.colors.themeColors[200]};

    &:hover {
      background: ${theme.colors.themeColors[400] || 'rgba(255,255,255,0.06)'};
      color: ${theme.colors.themeColors[100]};
    }
  `}
`
