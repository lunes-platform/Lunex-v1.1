import React, { ButtonHTMLAttributes, ReactNode } from 'react'
import Loading from '../loading'
import * as S from './styles'

export type ButtonProps = {
  children: ReactNode
  loading: boolean
  width: string
  size: string
  status: 'default' | 'secondary' | 'tertiary' | 'transparent'
  margin: string
  padding: string
} & ButtonHTMLAttributes<HTMLButtonElement>
/**
### Typagens disponíveis
- children: ReactNode/texto do botão
- loading: boolean/se ativo mostrará loading no lugar no texto
- width: string
- size:string
- status: 'default' | 'secondary' | 'tertiary' | 'transparent'
- margin: string
- padding: string
### Have fun and be happy!
*/
const Button = ({ children, loading, ...props }: Partial<ButtonProps>) => {
  return (
    <S.Button {...props} status={props.status || 'default'}>
      {loading ? <Loading purple={props.status == 'tertiary'} /> : children}
    </S.Button>
  )
}

export default Button
