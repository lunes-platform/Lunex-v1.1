import styled, { css } from 'styled-components'
import { ButtonProps } from '.'

export const Button = styled.button<Partial<ButtonProps>>`
  ${({ ...props }) => css`
    width: ${props.width || '100%'};
    height: 54px;
    margin: ${props.margin};
    padding: ${props.padding};
    outline: none;
    border: ${props.status === 'secondary'
      ? `1px solid${props.theme.colors.themeColors[100]}`
      : 'none'};
    border-radius: 16px;
    font-size: ${props.size || '16px'};
    font-weight: 600;
    font-family: 'Space Grotesk', sans-serif;
    display: flex;
    justify-content: center;
    text-align: center;
    align-items: center;
    box-shadow: ${props.status === 'transparent'
      ? 'none'
      : `0px 4px 8px rgba(0, 0, 0, 0.08)`};
    color: ${props.status === 'default'
      ? props.theme.colors.themeColors[700]
      : props.theme.colors.themeColors[100]};
    background-color: ${props.status === 'default'
      ? props.theme.colors.themeColors[800]
      : 'transparent'};
    :hover:not(:disabled) {
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      transform: scale(1.02);
      border: ${props.status === 'secondary'
        ? `1px solid${props.theme.colors.themeColors[800]}`
        : 'none'};
      color: ${props.status === 'default'
        ? props.theme.colors.themeColors[700]
        : props.theme.colors.themeColors[800]};
      background-color: ${props.status === 'default'
        ? props.theme.colors.primary[600]
        : props.status === 'transparent'
          ? 'transparent'
          : props.theme.colors.primary[100]};
    }
    :active:not(:disabled) {
      transition: all 0.1s cubic-bezier(0.4, 0, 0.2, 1);
      transform: scale(0.97) translateY(1px);
    }
    :focus {
      box-shadow: ${props.status === 'transparent'
        ? 'none'
        : `0px 0px 0px 1px rgba(0, 0, 0, 0.6),
        0px 0px 0px 4px rgba(108, 56, 255, 0.3)`};
      border: ${props.status === 'secondary'
        ? `1px solid${props.theme.colors.themeColors[800]}`
        : 'none'};
      color: ${props.status === 'default'
        ? props.theme.colors.themeColors[700]
        : props.theme.colors.themeColors[800]};
      background-color: ${props.status === 'default'
        ? props.theme.colors.themeColors[800]
        : props.status === 'transparent'
          ? 'transparent'
          : props.theme.colors.primary[100]};
    }
    :disabled {
      cursor: not-allowed;
      transition: none;
      transform: none;
      border: ${props.status === 'secondary'
        ? `1px solid${props.theme.colors.themeColors[300]}`
        : 'none'};
      color: ${props.status === 'tertiary'
        ? props.theme.colors.themeColors[400]
        : props.status === 'transparent'
          ? props.theme.colors.primary[100]
          : props.theme.colors.themeColors[300]};
      background-color: ${props.status === 'tertiary'
        ? 'transparent'
        : props.status === 'transparent'
          ? 'transparent'
          : props.theme.colors.themeColors[400]};
    }
  `}
`
