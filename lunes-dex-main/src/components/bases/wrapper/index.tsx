import React, { HtmlHTMLAttributes, ReactNode } from 'react'
import * as S from './styles'

export type WrapperProps = {
  children: ReactNode
  maxWidth: string
  minWidth: string
  width: string
  minHeight: string
  height: string
  margin: string
  padding: string
  border: string
  radius: boolean
  alignItems: string
  alignSelf: string
  justify: string
  direction: boolean
  bg: 400 | 500 | 600 | string | number
  shadow: boolean
  position: string
  display: string
  textAlign: string
  overflow: boolean
} & HtmlHTMLAttributes<HTMLElement>
/**
### Typagens disponíveis
- maxWidth: string
- minWidth: string
- width: string
- minHeight: string
- height: string
- margin: string
- padding: string
- border: string
- radius: boolean
- alignItems: string
- alignSelf: string
- justify: string
- direction: boolean/ se ativo padrão será row
- bg: 400 | 500 | 600 |string | number
- position: string
- display: string
- textAlign: string
- overflow: boolean
### Have fun and be happy!
*/
const Wrapper = ({
  children,
  direction,
  radius,
  overflow,
  ...props
}: Partial<WrapperProps>) => {
  return (
    <S.Wrapper
      {...props}
      radius={radius ? '16px' : '0'}
      direction={direction ? 'row' : 'column'}
      overflow={overflow ? 'hidden' : 'initial'}
    >
      {children}
    </S.Wrapper>
  )
}

export default Wrapper
