import styled, { css } from 'styled-components'

type StyledProps = {
  width: string
  height: string
  margin: string
  padding: string
  size: 'sm' | 'md' | 'lg' | string
  weight: 'bold' | 700 | 400 | string | number
  colors: 100 | 200 | string | number
  textAlign: string
  display: string
}
/**
### Typagens disponíveis
- width: string
- height: string
- margin: string
- padding: string
- size: 'sm' | 'md' | 'lg' | string
- weight: 'bold' | 700 | 400 | string | number
- colors: 100 | 200 | string | number
- textAlign: string
- display: string
### Have fun and be happy!
*/
const SubTitle = styled.h2<Partial<StyledProps>>`
  ${({ ...props }) => css`
    width: ${props.width || 'auto'};
    height: ${props.height};
    margin: ${props.margin};
    padding: ${props.padding};
    display: ${props.display || 'unset'};
    text-align: ${props.textAlign || 'center'};
    font-size: ${props.size === 'sm'
      ? '18px'
      : props.size === 'md'
        ? '24px'
        : props.size === 'lg'
          ? '32px'
          : props.size || '24px'};
    font-weight: ${props.weight === 'bold'
      ? 'bold'
      : props.weight === 700
        ? '700'
        : props.weight === 400
          ? '400'
          : props.weight || '700'};
    color: ${props.colors === 100
      ? props.theme.colors.themeColors[100]
      : props.colors === 200
        ? props.theme.colors.themeColors[200]
        : props.colors || props.theme.colors.themeColors[100]};
  `}
`

export default SubTitle
