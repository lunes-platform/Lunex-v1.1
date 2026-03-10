import styled, { css } from 'styled-components'
import { Wrapper } from 'components/bases'

export const Content = styled(Wrapper)`
  ${({ ...props }) => css`
    width: auto;
    display: flex;
    flex-direction: row;
    align-self: flex-start;
    justify-content: flex-start;
    background-color: transparent;
    button {
      width: auto;
      height: auto;
      margin-right: 12px;
      padding: 8px;
      font-size: 14px;
      font-weight: 500;
      border-radius: 8px;
      border: 1px solid ${props.theme.colors.themeColors[400]};
    }
  `}
`

export const LabelRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 auto -8px 0;
`

export const InfoWrapper = styled.div`
  ${({ theme }) => css`
    position: relative;
    display: flex;
    align-items: center;
    cursor: pointer;
    color: ${theme.colors.themeColors[200]};

    &:hover > span {
      visibility: visible;
      opacity: 1;
    }
  `}
`

export const TooltipText = styled.span`
  ${({ theme }) => css`
    visibility: hidden;
    opacity: 0;
    position: absolute;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: ${theme.colors.themeColors[400]};
    color: ${theme.colors.themeColors[100]};
    border: 1px solid ${theme.colors.themeColors[300]};
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 400;
    line-height: 1.5;
    max-width: 260px;
    width: max-content;
    text-align: left;
    z-index: 100;
    pointer-events: none;
    transition: opacity 0.15s;
    white-space: normal;
  `}
`
