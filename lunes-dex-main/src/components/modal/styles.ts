import styled, { css } from 'styled-components'
import { ModalProps } from '.'
import device from 'components/devices/devices'

type StyledProps = {
  padding: boolean
}

export const Container = styled.div`
  ${css`
    width: 100%;
    height: 100%;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 100;
    position: fixed;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 200ms ease-in-out;
    background-color: rgba(0, 0, 0, 0.5);
  `}
`

export const CloseExternal = styled.div`
  position: fixed;
  z-index: 115;
  inset: 0;
`

export const Close = styled.button`
  ${({ theme }) => css`
    width: 40px;
    height: 40px;
    font-size: 20px;
    cursor: pointer;
    color: ${theme.colors.themeColors[100]};
    border: none;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    position: absolute;
    top: 8px;
    right: 8px;
    transition:
      transform 0.3s ease-in-out,
      color 0.2s ease;
    transform: rotate(0deg);
    :hover {
      color: ${theme.colors.themeColors[800]};
      transition:
        transform 0.3s ease-in-out,
        color 0.2s ease;
      transform: rotate(-180deg);
    }
  `}
`

export const Content = styled.div<Partial<ModalProps>>`
  ${({ ...props }) => css`
    min-width: 488px;
    min-height: 174px;
    width: ${props.width};
    height: ${props.height};
    padding: 16px;
    border-radius: 16px;
    z-index: 150;
    position: relative;
    display: flex;
    flex-direction: ${props.direction ? 'row' : 'column'};
    align-items: center;
    justify-content: ${props.justify || 'center'};
    overflow: hidden;
    background-color: ${props.theme.colors.themeColors[500]};
    ${device.tablet} {
      min-width: auto;
      width: 95%;
      padding: 8px;
      h2 {
        font-size: 20px;
      }
    }
  `}
`

export const Divider = styled.hr`
  ${({ ...props }) => css`
    width: 107%;
    height: 1px;
    margin-left: -16px;
    border: none;
    background-color: ${props.theme.colors.themeColors[400]};
  `}
`

export const Icon = styled.img<StyledProps>`
  ${({ ...props }) => css`
    padding: ${props.padding ? '0' : '8px'};
    position: absolute;
    top: 16px;
    left: 16px;
    cursor: pointer;
    :hover {
      transition: all 0.2s;
      transform: translateY(0.7px);
    }
  `}
`
