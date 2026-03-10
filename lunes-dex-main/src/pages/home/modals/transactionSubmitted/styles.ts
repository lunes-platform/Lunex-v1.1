import styled, { css } from 'styled-components'
import { Paragraph } from 'components/bases'

export const View = styled(Paragraph)`
  ${({ ...props }) => css`
    margin: 0 0 32px;
    display: flex;
    align-items: center;
    align-self: start;
    :hover {
      transition: all 0.2s;
      transform: translateY(0.7px);
    }
    img {
      margin-right: 8px;
    }
  `}
`
