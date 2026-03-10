import styled, { css } from 'styled-components'
import { Wrapper } from 'components/bases'
import device from 'components/devices/devices'

export const BoxTokens = styled(Wrapper)`
  ${({ ...props }) => css`
    height: 560px;
    display: inline;
    overflow: auto;
    ::-webkit-scrollbar {
      width: 1px;
      height: 1px;
    }
    /* Handle */
    ::-webkit-scrollbar-thumb {
      border-radius: 50px;
      background: #68f285;
    }
  `}
`

export const Content = styled(Wrapper)`
  ${({ ...props }) => css`
    margin: 24px 0 8px;
    display: grid;
    grid-template-columns: 1fr 1fr 0.1fr;
    justify-items: flex-start;
    cursor: pointer;
    p,
    span {
      cursor: pointer;
      display: flex;
      align-items: center;
      user-select: none;
      img {
        max-width: 24px;
        height: 24px;
        margin-right: 8px;
      }
    }
    :hover {
      transition: all 0.2s;
      transform: translateY(0.7px);
      filter: brightness(0.9);
    }
    :active {
      transition: all 0.2s;
      transform: translateY(-0.7px);
    }
    ${device.mobileL} {
      span {
        font-size: 10px;
      }
      p {
        font-size: 13px;
      }
    }
    ${device.mobileS} {
      p {
        font-size: 12px;
      }
    }
  `}
`
