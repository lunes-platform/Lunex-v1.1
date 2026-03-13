import styled, { css } from 'styled-components'
import { Wrapper, Button } from 'components/bases'
import Modals from 'components/modal'
import device from 'components/devices/devices'

export const Modal = styled(Modals)`
  ${({ ...props }) => css`
    height: 670px;
    ${device.mobileL} {
      height: 550px;
    }
    ${device.mobileS} {
      height: 430px;
    }
  `}
`

export const Content = styled(Wrapper)`
  ${({ ...props }) => css`
    position: relative;
    flex-direction: row;
    justify-content: space-evenly;
    background-color: transparent;
    h2 {
      position: absolute;
      inset: -40px 0;
      letter-spacing: 1px;
      display: inline-table;
      justify-self: center;
      ${device.tablet} {
        font-size: 16px;
      }
      ${device.mobileS} {
        inset: -30px 0;
      }
    }
  `}
`

export const Network = styled(Button)`
  ${({ ...props }) => css`
    width: 150px;
    height: 100px;
    justify-content: space-evenly;
    flex-direction: column;
    img {
      width: 36px;
      height: 36px;
      object-fit: contain;
      border-radius: 8px;
    }
    strong {
      font-size: 10px;
      letter-spacing: 1px;
    }
    ${device.tablet} {
      width: 90px;
      height: 90px;
      font-size: 14px;
    }
    ${device.mobileL} {
      width: 50px;
      height: 50px;
      padding: 8px 8px 8px 8.3px;
      font-size: 0px;
      border-radius: 50px;
      strong {
        display: none;
      }
      img {
        width: 28px;
        height: 28px;
        margin: auto;
      }
    }
  `}
`

export const Paragraph = styled.span`
  ${({ ...props }) => css`
    font-size: 16px;
    font-weight: 400;
    text-align: center;
    color: ${props.theme.colors.themeColors[100]};
    strong {
      color: ${props.theme.colors.themeColors[800]};
    }
    ${device.mobileL} {
      font-size: 14px;
    }
  `}
`
