import React, { InputHTMLAttributes } from 'react'

import * as S from './styles'
import theme from 'theme'

type InputProps = {
  width: string
  height: string
  sizeInput: string
  margin: string
  border: boolean
  alignItems: boolean
  sizeInputName: string
  status: 'default' | 'success' | 'warning' | 'error'
  textStatus: string
  inputName: string
  inputNameRight: string
  iconLeft: string
  iconRight: string
  toggleIcon: React.MouseEventHandler<HTMLImageElement> | undefined
  cursor: boolean
  textLink: React.MouseEventHandler<HTMLImageElement> | undefined
} & InputHTMLAttributes<HTMLInputElement>
/**
### Typagens disponíveis
- width: string
- height: string
- sizeInput: string
- margin: string
- border: boolean
- alignItems: boolean
- sizeInputName: string
- status: 'default' | 'success' | 'warning' | 'error'
- textStatus: string
- inputName: string
- inputNameRight: string
- iconLeft: string | StaticImageData
- iconRight: string | StaticImageData
- toggleIcon: Evento de onClick
- cursor: boolean
- textLink: React.MouseEventHandler<HTMLImageElement> | undefined
### Have fun and be happy!
*/
const Input = ({ cursor, ...props }: Partial<InputProps>) => {
  return (
    <S.Wrapper {...props} alignItems={props.alignItems} margin={props.margin}>
      {props.inputName && (
        <S.Text weightText sizeInputName={props.sizeInputName}>
          {props.inputName}
        </S.Text>
      )}
      {props.inputNameRight && (
        <S.TextLink
          cursor={cursor ? 'pointer' : 'default'}
          onClick={props.textLink}
          colorHover={cursor ? theme.colors.themeColors[800] : undefined}
        >
          {props.inputNameRight}
        </S.TextLink>
      )}

      <S.Content>
        {props.iconLeft && (
          <S.IconLeft
            src={props.iconLeft || ''}
            alt="left side icon"
            width={24}
            height={24}
          />
        )}
        <S.Input
          {...props}
          status={props.status || 'default'}
          paddingL={props.iconLeft ? '48px' : '16px'}
          paddingR={props.iconRight ? '48px' : '16px'}
        />
        {props.iconRight && (
          <S.IconRight
            src={props.iconRight || ''}
            alt="right side icon"
            onClick={props.toggleIcon}
            width={24}
            height={24}
          />
        )}
      </S.Content>

      {props.textStatus && (
        <S.Text {...props} sizeInputName="14px">
          <img
            src={
              (props.status === 'success' && 'img/success.svg') ||
              (props.status === 'warning' && 'img/warning.svg') ||
              (props.status === 'error' && 'img/error.svg') ||
              undefined
            }
            alt="status component"
            width={16}
            height={16}
          />
          {props.textStatus}
        </S.Text>
      )}
    </S.Wrapper>
  )
}

export default Input
