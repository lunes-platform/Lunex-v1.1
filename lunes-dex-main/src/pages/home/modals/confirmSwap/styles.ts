import styled, { css } from 'styled-components'
import { Wrapper } from 'components/bases'
import device from 'components/devices/devices'

export const Content = styled(Wrapper)`
  ${({ ...props }) => css`
    height: 140px;
    padding: 16px;
    margin: 20px 8px 0;
    border-radius: 16px;
    align-items: flex-start;
    justify-content: space-between;
    background-color: ${props.theme.colors.themeColors[600]};
    p {
      display: flex;
      align-items: flex-start;
      img {
        max-width: 24px;
        max-height: 24px;
        margin-right: 8px;
      }
    }
    ${device.mobileL} {
      height: 120px;
      padding: 10px;
      margin: 16px 8px 0;
      p:first-child {
        font-size: 18px;
      }
      p {
        font-size: 14px;
      }
      span {
        font-size: 12px;
      }
    }
    ${device.mobileS} {
      height: 100px;
      margin: 10px 8px 0;
      p:first-child {
        font-size: 16px;
      }
      p {
        font-size: 13px;
      }
      span {
        font-size: 11px;
      }
    }
  `}
`

export const BoxDescriptions = styled(Wrapper)`
  ${({ ...props }) => css`
    ${device.mobileL} {
      padding: 0 8px 16px;
    }
    ${device.mobileS} {
      button {
        height: 44px;
      }
    }
  `}
`

export const Descriptions = styled(Wrapper)`
  ${({ ...props }) => css`
    margin: 14px 0;
    padding: 10px;
    line-height: 2;
    flex-direction: row;
    justify-content: space-between;
    background-color: transparent;
    transition: opacity 0.5s linear;
    span {
      font-weight: 500;
    }
    div:last-child {
      span:nth-child(3) {
        color: ${props.theme.colors.success[500]};
      }
    }
    ${device.mobileL} {
      padding: 0 8px;
      line-height: 1.9;
      p,
      span {
        font-size: 13px;
      }
    }
    ${device.mobileS} {
      margin: 10px 0;
      line-height: 1.7;
      p,
      span {
        font-size: 12px;
      }
    }
  `}
`
