import styled, { css } from 'styled-components'
import { CheckboxProps } from '.'

export const Container = styled.button<Partial<CheckboxProps>>`
  ${({ ...props }) => css`
    margin: ${props.margin};
    padding: ${props.padding};
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: row;
    background-color: transparent;
  `}
`

export const Wrapper = styled.div<Partial<CheckboxProps>>`
  ${({ ...props }) => css`
    width: 20px;
    height: 20px;
    border-radius: 4px;
    overflow: hidden;
    background-color: ${props.colors
      ? props.theme.colors.themeColors[100]
      : 'transparent'};
    border: 1px solid
      ${props.border
        ? props.theme.colors.themeColors[800]
        : props.isError
          ? props.theme.colors.critical[400]
          : props.theme.colors.themeColors[300]};
  `}
`

export const Checkbox = styled.div<Partial<CheckboxProps>>`
  ${({ ...props }) => css`
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: ${props.colors
      ? props.theme.colors.themeColors[100]
      : props.theme.colors.themeColors[300]};
    background-color: ${props.colors
      ? props.theme.colors.themeColors[800]
      : 'transparent'};
  `}
`
