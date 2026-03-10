import React, { HtmlHTMLAttributes } from 'react'
import * as S from './styles'

export type LoadingProps = {
  size: string
  border: string
  purple: boolean
} & HtmlHTMLAttributes<HTMLElement>
/**
### Typagens disponíveis
- size: string/tamanho do loading
- border: string/tamanho da borda
- colors: boolean/se ativo retona roxo
### Have fun and be happy!
*/
const Loading = ({ ...props }: Partial<LoadingProps>) => {
  return <S.Loading {...props} />
}

export default Loading
