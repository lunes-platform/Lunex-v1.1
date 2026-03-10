import styled, { css, keyframes } from 'styled-components'
import { LoadingProps } from '.'

const AnimationLoading = keyframes`
  to {
    transform: rotate(360deg);
  }
`

export const Loading = styled.div<Partial<LoadingProps>>`
  ${({ ...props }) => css`
    width: ${props.size || '30px'};
    height: ${props.size || '30px'};
    border-radius: 50%;
    border: ${props.border || '2px'} solid transparent;
    border-left-color: ${props.purple
      ? props.theme.colors.themeColors[800]
      : props.theme.colors.themeColors[700]};
    animation: ${AnimationLoading} 0.8s linear infinite;
  `}
`
