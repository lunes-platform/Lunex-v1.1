import styled, { css } from 'styled-components'
import { Wrapper } from 'components/bases'
import device from 'components/devices/devices'

type StyledProps = {
  active?: boolean
  isToken?: boolean
  inset?: string
  size?: string
}

export const PillNav = styled(Wrapper)`
  width: fit-content;
  background: #1A1A1A;
  border-radius: 12px;
  padding: 4px;
  margin-bottom: 24px;
  gap: 4px;
`

export const PillOption = styled.button<{ active?: boolean }>`
  ${({ theme, active }) => css`
    padding: 8px 16px;
    border: none;
    background: ${active ? theme.colors.themeColors[800] : 'transparent'};
    border-radius: 8px;
    color: ${active ? '#FFFFFF' : '#8A8A8E'};
    font-weight: 600;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
      color: #FFFFFF;
      background: ${active ? theme.colors.themeColors[800] : '#2A2A2C'};
    }
  `}
`

export const Box = styled(Wrapper)`
  ${({ ...props }) => css`
    position: relative;
    z-index: 2;

    ${device.laptop} {
      min-height: auto;
    }
    ${device.mobileL} {
      min-height: auto;
      padding: 0 16px 24px;
    }
  `}
`

export const Content = styled(Wrapper)`
  ${({ ...props }) => css`
    margin: 24px 0 16px;
    background-color: transparent;
    img {
      margin: -16px 0;
      z-index: 10;
    }
    input {
      :disabled {
        cursor: default;
        color: ${props.theme.colors.themeColors[200]};
      }
      ${device.tablet} {
        font-size: 20px;
      }
      ${device.mobileL} {
        height: 162px;
        font-size: 18px;
      }
    }
  `}
`

export const Span = styled.span<StyledProps>`
  ${({ ...props }) => css`
    width: 100%;
    height: 56px;
    font-size: 16px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: ${props.active
      ? 'pointer'
      : 'not-allowed'}; //deixar apenas pointer após criado component "Liquidity pool"
    border-bottom: 1px solid
      ${props.active ? props.theme.colors.themeColors[800] : 'transparent'};
    color: ${props.active
      ? props.theme.colors.themeColors[100]
      : props.theme.colors.themeColors[400]};
  `}
`

export const Details = styled.span<StyledProps>`
  ${({ ...props }) => css`
    font-size: ${props.size || '16px'};
    font-weight: ${props.active ? 400 : 600};
    z-index: 10;
    position: absolute;
    inset: ${props.inset};
    color: ${props.active
      ? props.theme.colors.themeColors[200]
      : props.theme.colors.themeColors[100]};
    strong {
      color: ${props.theme.colors.success[500]};
    }
    ${device.mobileL} {
      font-size: 14px;
    }
    ${device.mobileS} {
      font-size: 12px;
    }
  `}
`

export const Token = styled.button<StyledProps>`
  ${({ ...props }) => css`
    min-width: ${props.isToken ? '169px' : '136px'};
    height: 40px;
    padding: 8px;
    font-size: 16px;
    font-weight: 600;
    border-radius: 16px;
    position: absolute;
    z-index: 10;
    right: 16px;
    bottom: 16px;
    display: flex;
    align-items: center;
    justify-content: space-around;
    color: ${props.theme.colors.themeColors[100]};
    background-color: ${props.isToken
      ? props.theme.colors.themeColors[800]
      : props.theme.colors.themeColors[400]};
    img {
      max-width: 24px;
      max-height: 24px;
    }
    ${device.mobileL} {
      min-width: ${props.isToken ? '116px' : '105px'};
      padding: 4px;
      font-size: 13px;
      right: 12px;
      bottom: 12px;
    }
    ${device.mobileS} {
      min-width: ${props.isToken ? '110px' : '105px'};
      font-size: 12.5px;
      right: 8px;
      bottom: 8px;
    }
  `}
`

export const Descriptions = styled(Wrapper)`
  ${({ ...props }) => css`
    margin-bottom: 14px;
    padding: 8px;
    line-height: 2;
    flex-direction: row;
    justify-content: space-between;
    background-color: transparent;
    transition: opacity 0.5s linear;
    p {
      font-size: 16px;
      font-weight: 600;
      color: ${props.theme.colors.themeColors[100]};
    }
    span {
      font-size: 14px;
      font-weight: 500;
      color: ${props.theme.colors.themeColors[200]};
    }
    ${device.mobileL} {
      padding: 10px 0;
      p,
      span {
        font-size: 13px;
      }
    }
    ${device.mobileS} {
      p,
      span {
        font-size: 12px;
      }
    }
  `}
`

export const Paragraph = styled.span<StyledProps>`
  ${({ ...props }) => css`
    margin-top: 20px;
    font-size: 14px;
    font-weight: normal;
    color: ${props.theme.colors.themeColors[100]};
    strong {
      color: ${props.theme.colors.themeColors[800]};
    }
  `}
`
