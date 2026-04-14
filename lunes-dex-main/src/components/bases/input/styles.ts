import styled, { css } from 'styled-components'

type StyledProps = {
  width: string
  height: string
  sizeInput: string
  margin: string
  paddingL: string
  paddingR: string
  border: boolean
  sizeInputName: string
  weightText: boolean
  alignItems: boolean
  status: 'default' | 'success' | 'warning' | 'error'
  cursor: string
  colorHover: string
}

export const Wrapper = styled.div<Partial<StyledProps>>`
  ${({ ...props }) => css`
    width: ${props.width || '100%'};
    margin: ${props.margin};
    display: flex;
    align-items: ${props.alignItems ? 'center' : 'flex-start'};
    justify-content: flex-start;
    flex-direction: column;
    position: relative;
  `}
`

export const Content = styled.div<Partial<StyledProps>>`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  :hover {
    transition: all 0.2s;
  }
  :active {
    transition: none;
    transform: translateY(0.7px);
  }
`

export const IconLeft = styled.img`
  max-width: 24px;
  max-height: 24px;
  position: absolute;
  left: 16px;
  z-index: 10;
`

export const IconRight = styled(IconLeft)`
  right: 16px;
  left: auto;
  cursor: pointer;
`

export const Text = styled.p<Partial<StyledProps>>`
  ${({ ...props }) => css`
    margin: 8px 0;
    font-size: ${props.sizeInputName || '16px'};
    font-weight: ${props.weightText ? '600' : '500'};
    display: flex;
    text-align: left;
    color: ${props.status === 'success'
      ? props.theme.colors.success[500]
      : props.status === 'warning'
        ? props.theme.colors.warning[500]
        : props.status === 'error'
          ? props.theme.colors.critical[500]
          : props.theme.colors.themeColors[100]};
    img {
      margin-right: 8px;
    }
  `}
`

export const TextLink = styled(Text)<Partial<StyledProps>>`
  ${({ ...props }) => css`
    cursor: ${props.cursor};
    position: absolute;
    user-select: none;
    top: 0;
    right: 0;
    :hover {
      transition: all 0.2s;
      color: ${props.colorHover};
    }
  `}
`

export const Input = styled.input<Partial<StyledProps>>`
  ${({ ...props }) => css`
    width: 100%;
    height: ${props.height || '54px'};
    font-size: ${props.sizeInput || '16px'};
    padding-right: ${props.paddingR};
    padding-left: ${props.paddingL};
    z-index: 5;
    outline: none;
    border: 1px solid
      ${props.border
        ? props.theme.colors.themeColors[100]
        : props.status === 'success'
          ? props.theme.colors.success[500]
          : props.status === 'warning'
            ? props.theme.colors.warning[500]
            : props.status === 'error'
              ? props.theme.colors.critical[500]
              : 'transparent'};
    border-radius: 16px;
    display: flex;
    text-align: left;
    align-items: center;
    justify-content: center;
    color: ${props.status === 'success'
      ? props.theme.colors.success[500]
      : props.status === 'warning'
        ? props.theme.colors.warning[500]
        : props.status === 'error'
          ? props.theme.colors.critical[500]
          : props.theme.colors.themeColors[100]};
    background-color: ${props.theme.colors.themeColors[600]};
    ::placeholder {
      color: ${props.status === 'success'
        ? props.theme.colors.success[500]
        : props.status === 'warning'
          ? props.theme.colors.warning[500]
          : props.status === 'error'
            ? props.theme.colors.critical[500]
            : props.theme.colors.themeColors[200]};
    }
    :hover {
      border: 1px solid
        ${props.status === 'success'
          ? props.theme.colors.success[500]
          : props.status === 'warning'
            ? props.theme.colors.warning[500]
            : props.status === 'error'
              ? props.theme.colors.critical[500]
              : props.theme.colors.themeColors[800]};
    }
    :focus {
      background-color: ${props.theme.colors.themeColors[500]};
      border: 1px solid
        ${props.status === 'success'
          ? props.theme.colors.success[500]
          : props.status === 'warning'
            ? props.theme.colors.warning[500]
            : props.status === 'error'
              ? props.theme.colors.critical[500]
              : props.theme.colors.themeColors[800]};
      box-shadow: ${props.status === 'default'
        ? `0px 0px 0px 1px rgba(0, 0, 0, 0.6),
        0px 0px 0px 4px rgba(108, 56, 255, 0.3)`
        : 'none'};
      ::placeholder {
        color: ${props.status === 'success'
          ? props.theme.colors.success[500]
          : props.status === 'warning'
            ? props.theme.colors.warning[500]
            : props.status === 'error'
              ? props.theme.colors.critical[500]
              : props.theme.colors.themeColors[100]};
      }
    }
    :disabled {
      cursor: not-allowed;
      transition: none;
      transform: none;
      border: 1px solid transparent;
      color: ${props.theme.colors.themeColors[300]};
      background-color: ${props.theme.colors.themeColors[400]};
      ::placeholder {
        color: ${props.theme.colors.themeColors[300]};
      }
    }
  `}
`
