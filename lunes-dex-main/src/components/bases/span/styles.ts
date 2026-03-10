import styled, { css } from 'styled-components'

type StyledProps = {
  width: string
  height: string
  margin: string
  padding: string
  size: 'sm' | 'md' | 'lg' | string
  weight: 'bold' | 700 | 400 | string | number
  colors: 100 | 200 | 400 | 500 | 800 | string | number
  textAlign: string
  numberOfLines: number | string
  cursor: string
  colorHover: string
  select: string
}

export const Span = styled.span<Partial<StyledProps>>`
  ${({ ...props }) => css`
    width: ${props.width || 'auto'};
    height: ${props.height};
    margin: ${props.margin};
    padding: ${props.padding};
    text-align: ${props.textAlign || 'center'};
    font-size: ${props.size === 'sm'
      ? '12px'
      : props.size === 'md'
      ? '14px'
      : props.size === 'lg'
      ? '16px'
      : props.size || '14px'};
    font-weight: ${props.weight === 'bold'
      ? 'bold'
      : props.weight === 700
      ? '700'
      : props.weight === 400
      ? '400'
      : 'normal'};
    color: ${props.colors === 100
      ? props.theme.colors.themeColors[100]
      : props.colors === 200
      ? props.theme.colors.themeColors[200]
      : props.colors === 400
      ? props.theme.colors.critical[400]
      : props.colors === 500
      ? props.theme.colors.success[500]
      : props.colors === 800
      ? props.theme.colors.themeColors[800]
      : props.colors || props.theme.colors.themeColors[200]};
    overflow: ${props.numberOfLines ? 'hidden' : 'unset'};
    display: ${props.numberOfLines ? '-webkit-box' : 'unset'};
    -webkit-line-clamp: ${props.numberOfLines || 'unset'};
    -webkit-box-orient: ${props.numberOfLines ? 'vertical' : 'unset'};
    cursor: ${props.cursor};
    user-select: ${props.select};
    :hover {
      transition: all 0.2s;
      color: ${props.colorHover};
    }
  `}
`
