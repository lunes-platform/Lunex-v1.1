import styled, { css } from 'styled-components'

type StyledProps = {
  width: string
  height: string
  margin: string
  padding: string
  textAlign: string
  display: string
  direction: string
  alignItems: string
  justify: string
  cursor: string
}
/**
### Typagens disponíveis
- width: string
- height: string
- margin: string
- padding: string
- textAlign: string
- display: string
- direction: string
- alignItems: string
- justify: string
- cursor: string
### Have fun and be happy!
*/
const Links = styled.a<Partial<StyledProps>>`
  ${({ ...props }) => css`
    width: ${props.width};
    height: ${props.height};
    margin: ${props.margin};
    padding: ${props.padding};
    display: ${props.display || 'flex'};
    flex-direction: ${props.direction || 'column'};
    align-items: ${props.alignItems || 'center'};
    justify-content: ${props.justify || 'center'};
    cursor: ${props.justify || 'pointer'};
    :hover {
      transition: all 0.2s;
      transform: translateY(0.7px);
      filter: brightness(0.9);
    }
    :active {
      transition: all 0.2s;
      transform: translateY(-0.7px);
    }
  `}
`

export default Links
