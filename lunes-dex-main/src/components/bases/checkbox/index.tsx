import React, { HtmlHTMLAttributes, MouseEventHandler, ReactNode } from 'react'
import * as S from './styles'
import Paragraph from '../paragraph'

export type CheckboxProps = {
  children: ReactNode
  isChecked: boolean | number | string
  setIsChecked: MouseEventHandler<HTMLButtonElement> | undefined
  margin: string
  padding: string
  colors: boolean | number | string
  border: boolean | number | string
  isError: boolean
} & HtmlHTMLAttributes<HTMLElement>
/**
### Typagens disponíveis
- children: ReactNode/texto do checkbox
- isChecked: boolean | number | string
- setIsChecked: evento de onClick
- margin: string
- padding: string
- colors: boolean | number | string
- border: boolean | number | string
- isError: boolean
### Have fun and be happy!
*/
const Checkbox = ({
  children,
  isError,
  isChecked,
  setIsChecked,
  ...props
}: Partial<CheckboxProps>) => {
  return (
    <S.Container
      onClick={setIsChecked}
      margin={props.margin}
      padding={props.padding}
    >
      <S.Wrapper
        {...props}
        border={isChecked}
        isError={isError}
        colors={isChecked}
      >
        <S.Checkbox {...props} colors={isChecked}>
          ✔
        </S.Checkbox>
      </S.Wrapper>
      <Paragraph padding="0 8px" colors={isError ? 400 : 100}>
        {children}
      </Paragraph>
    </S.Container>
  )
}

export default Checkbox
