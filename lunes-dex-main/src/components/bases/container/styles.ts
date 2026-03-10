import device from 'components/devices/devices'
import styled, { css } from 'styled-components'

type StyledProps = {
  width: string
  height: string
  margin: string
  padding: string
  textAlign: string
  alignItems: string
  alignSelf: string
  justify: string
  direction: string
  display: string
  bg: string
  overflow: boolean | string
}

export const Container = styled.section<Partial<StyledProps>>`
  ${({ ...props }) => css`
    width: ${props.width || '100%'};
    height: ${props.height || 'calc(100% - 80px)'};
    margin: ${props.margin || '0'};
    padding: ${props.padding};
    text-align: ${props.textAlign || 'center'};
    display: ${props.display || 'flex'};
    align-self: ${props.alignSelf || 'center'};
    align-items: ${props.alignItems || 'center'};
    justify-content: ${props.justify || 'center'};
    flex-direction: ${props.direction};
    background-color: ${props.bg || props.theme.colors.themeColors[500]};
    /* overflow: ${props.overflow ? '' : ''}; */
    ${device.mobileL} {
      height: 100%;
    }
  `}
`
