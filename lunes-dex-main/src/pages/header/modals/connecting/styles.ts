import styled, { css } from 'styled-components'
import { Paragraph, Wrapper } from 'components/bases'
import device from 'components/devices/devices'

export const Content = styled(Wrapper)`
  ${({ ...props }) => css`
    ${device.mobileL} {
      margin: 16px;
      padding: 16px;
    }
  `}
`

export const Description = styled(Paragraph)`
  ${({ ...props }) => css`
    line-height: 24px;
    font-weight: 400;
    letter-spacing: 1px;
    strong {
      cursor: pointer;
      color: ${props.theme.colors.themeColors[800]};
    }
    ${device.mobileL} {
      font-size: 14px;
    }
  `}
`
