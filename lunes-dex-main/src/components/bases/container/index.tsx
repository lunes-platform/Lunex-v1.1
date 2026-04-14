import { type HtmlHTMLAttributes, type ReactNode } from 'react'
import * as S from './styles'

type ContainerProps = {
  children: ReactNode
  width: string
  height: string
  margin: string
  padding: string
  textAlign: string
  alignItems: string
  alignSelf: string
  justify: string
  direction: boolean
  display: string
  bg: string
  // overflow: string
} & HtmlHTMLAttributes<HTMLElement>
/**
### Typagens disponíveis
- width: string
- height: string
- margin: string
- padding: string
- textAlign: string
- alignItems: string
- alignSelf: string
- justify: string
- direction: boolean/ se ativo padrão será row
- display: string
- bg: string
- overflow: string
### Have fun and be happy!
*/
const Container = ({
  children,
  direction,
  ...props
}: Partial<ContainerProps>) => {
  return (
    <S.Container {...props} direction={direction ? 'row' : 'column'}>
      {children}
    </S.Container>
  )
}

export default Container
