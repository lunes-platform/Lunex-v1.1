import styled, { css } from 'styled-components'
import { Wrapper, Span } from 'components/bases'
import device from 'components/devices/devices'

type StyledProps = {
  status?: boolean
}

export const Content = styled(Wrapper)`
  ${({ ...props }) => css`
    height: 138px;
    padding: 16px;
    margin: 20px 8px;
    border-radius: 16px;
    background-color: transparent;
    justify-content: space-between;
    border: 1px solid ${props.theme.colors.themeColors[400]};
    button {
      width: 92px;
      height: 30px;
      margin-left: 8px;
      font-size: 14px;
      font-weight: 500;
      border-radius: 8px;
      border: 1px solid ${props.theme.colors.themeColors[400]};
    }
    ${device.mobileL} {
      padding: 10px;
      p,
      span {
        font-size: 14px;
        text-align: left;
      }
      button {
        margin-left: 4px;
        padding: 4px;
        font-size: 12px;
      }
    }
  `}
`

export const Address = styled(Span)`
  ${css`
    width: 30%;
    margin-right: auto;
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
  `}
`

export const LinkBox = styled(Wrapper)`
  ${css`
    span {
      display: flex;
      align-items: center;
      :hover {
        transition: all 0.2s;
        transform: translateY(0.7px);
      }
    }
    img {
      margin-right: 5px;
    }
  `}
`

export const BoxTransaction = styled(Wrapper)`
  ${css`
    ${device.mobileL} {
      padding: 32px 16px;
    }
  `}
`

export const Status = styled(Wrapper)<StyledProps>`
  ${({ ...props }) => css`
    margin: 8px 0 0;
    justify-content: space-between;
    p {
      display: flex;
      align-items: flex-start;
      :hover {
        transition: all 0.2s;
        transform: translateY(0.7px);
      }
    }
    span {
      width: 71px;
      height: 30px;
      font-size: 14px;
      font-weight: 500;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: ${props.status
        ? props.theme.colors.warning[500]
        : props.theme.colors.success[500]};
      background-color: ${props.status
        ? props.theme.colors.warning[100]
        : props.theme.colors.success[100]};
      cursor: pointer;
    }
    img {
      margin-left: 5px;
    }
    ${device.mobileL} {
      flex-direction: column;
      align-items: flex-start;
      p {
        margin-bottom: 8px;
        font-size: 14px;
      }
    }
  `}
`
