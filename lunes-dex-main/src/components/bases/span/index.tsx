import React, { HtmlHTMLAttributes, ReactNode } from 'react'
import * as S from './styles'
import theme from 'theme'

export type SpanProps = {
  children: ReactNode
  width: string
  height: string
  margin: string
  padding: string
  size: 'sm' | 'md' | 'lg' | string
  weight: 'bold' | 700 | 400 | string | number
  colors: 100 | 200 | 400 | 500 | 800 | string | number
  textAlign: string
  numberOfLines: number | string
  cursor: boolean
} & HtmlHTMLAttributes<HTMLElement>
/**
### Typagens disponíveis
- width: string
- height: string
- margin: string
- padding: string
- size: 'sm' | 'md' | 'lg' | string
- weight: 'bold' | 700 | 400 | string | number
- colors: 100 | 200 | 400 | 500 | 800 | string | number
- textAlign: string
- numberOfLines: number | string
- cursor: boolean/se ativo padrão será pointer
### Have fun and be happy!
*/
const Span = ({ children, cursor, ...props }: Partial<SpanProps>) => {
  return (
    <S.Span
      {...props}
      cursor={cursor ? 'pointer' : 'default'}
      colorHover={cursor ? theme.colors.themeColors[800] : undefined}
      select={cursor ? 'none' : 'text'}
    >
      {children}
    </S.Span>
  )
}

export default Span
