import styled, { css } from 'styled-components'

type StyledProps = {
  maxWidth: string
  minWidth: string
  width: string
  minHeight: string
  height: string
  margin: string
  padding: string
  border: string
  radius: string
  alignItems: string
  alignSelf: string
  justify: string
  direction: string
  bg: 400 | 500 | 600 | string | number
  shadow: boolean
  position: string
  display: string
  textAlign: string
  overflow: string
}

export const Wrapper = styled.div<Partial<StyledProps>>`
  ${({ ...props }) => css`
    max-width: ${props.maxWidth || '100%'};
    min-width: ${props.minWidth};
    width: ${props.width || '100%'};
    min-height: ${props.minHeight};
    height: ${props.height};
    margin: ${props.margin};
    padding: ${props.padding};
    border: ${props.border || 'none'};
    border-radius: ${props.radius};
    display: ${props.display || 'flex'};
    text-align: ${props.textAlign || 'center'};
    flex-direction: ${props.direction};
    align-self: ${props.alignSelf || 'center'};
    align-items: ${props.alignItems || 'center'};
    justify-content: ${props.justify || 'center'};
    background-color: ${props.bg === 500
      ? props.theme.colors.themeColors[500]
      : props.bg === 600
      ? props.theme.colors.themeColors[600]
      : props.bg === 400
      ? props.theme.colors.themeColors[400]
      : props.bg || props.theme.colors.themeColors[600]};
    box-shadow: ${props.shadow ? '0px 0px 500px -70px #6c38fe' : 'none'};
    position: ${props.position || 'initial'};
    overflow: ${props.overflow};
    animation: ${props.shadow ? 'pulse 1s infinite' : 'none'};
    @keyframes pulse {
      0% {
        -moz-box-shadow: 0px 0px 500px -60px #6c38fe;
        box-shadow: 0px 0px 500px -60px #6c38fe;
      }
      /* 70% {
        -moz-box-shadow: 0px 0px 500px -70px #6c38fe;
        box-shadow: 0px 0px 500px -70px #6c38fe;
      }
      100% {
        -moz-box-shadow: 0px 0px 250px -60px #6c38fe;
        box-shadow: 0px 0px 250px -60px #6c38fe;
      } */
    }
  `}
`
