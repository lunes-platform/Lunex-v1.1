import styled, { css } from 'styled-components'
import { Paragraph } from 'components/bases'

export const Description = styled(Paragraph)`
  ${({ ...props }) => css`
    line-height: 24px;
    font-weight: 400;
    letter-spacing: 1px;
    strong {
      cursor: pointer;
      color: ${props.theme.colors.themeColors[800]};
    }
  `}
`
