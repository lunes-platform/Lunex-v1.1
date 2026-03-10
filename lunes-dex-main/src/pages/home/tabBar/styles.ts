import styled, { css } from 'styled-components'
import { Wrapper } from 'components/bases'
import device from 'components/devices/devices'

type StyledProps = {
  active?: boolean
}

export const Container = styled(Wrapper)<StyledProps>`
  ${({ ...props }) => css`
    width: 481px;
    margin: 0 0 20px;
    padding: 0 16px 0 4px;
    position: relative;
    ${device.mobileL} {
      width: 100%;
    }
  `}
`

export const Span = styled.span<StyledProps>`
  ${({ ...props }) => css`
    width: 100%;
    height: 56px;
    font-size: 16px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: ${props.active
      ? 'pointer'
      : 'not-allowed'}; //deixar apenas pointer após criado outros componentes
    color: ${props.active
      ? props.theme.colors.themeColors[800]
      : props.theme.colors.themeColors[200]};
    ::before {
      content: '● ';
      width: auto;
      margin: 0 4px;
      color: ${props.active
        ? props.theme.colors.themeColors[800]
        : props.theme.colors.themeColors[500]};
    }
    ${device.laptop} {
      font-size: 14px;
    }
    ${device.mobileS} {
      font-size: 12px;
    }
  `}
`
