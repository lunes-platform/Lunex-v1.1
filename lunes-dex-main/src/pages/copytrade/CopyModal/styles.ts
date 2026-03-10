import styled from 'styled-components'

export const ContentArea = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 4px 0 0;
`

export const LeaderCard = styled.div`
  background: ${({ theme }) => theme.colors.themeColors[600]};
  border: 1px solid ${({ theme }) => theme.colors.themeColors[400]};
  border-radius: 16px;
  padding: 18px;
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 0;
`

export const InfoRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  padding: 12px 0;

  &:not(:last-child) {
    border-bottom: 1px solid ${({ theme }) => theme.colors.themeColors[400]};
  }

  span {
    color: ${({ theme }) => theme.colors.themeColors[200]};
    font-size: 12px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-family: 'Inter', sans-serif;
    line-height: 1.45;
  }

  strong {
    color: #ffffff;
    font-size: 15px;
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 700;
    line-height: 1.45;
    text-align: right;
  }
`

export const AccentValue = styled.strong`
  color: ${({ theme }) => theme.colors.warning[500]} !important;
`

export const Label = styled.label`
  display: block;
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  margin-bottom: 8px;
`

export const InputHint = styled.p`
  margin: 0 0 12px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
  font-size: 12px;
  line-height: 1.45;
  font-family: 'Inter', sans-serif;
`

export const InputWrapper = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  border-radius: 12px;
  border: 1px solid ${({ theme }) => theme.colors.themeColors[400]};
  background: ${({ theme }) => theme.colors.themeColors[600]};
`

export const Input = styled.input`
  width: 100%;
  background: transparent;
  border: none;
  border-radius: 12px;
  padding: 15px 56px 15px 16px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 20px;
  font-weight: 700;
  color: #ffffff;
  outline: none;

  &::placeholder {
    color: ${({ theme }) => theme.colors.themeColors[200]};
  }

  &:focus {
    box-shadow: inset 0 0 0 1px ${({ theme }) => theme.colors.themeColors[800]};
  }
`

export const CurrencyLabel = styled.span`
  position: absolute;
  right: 16px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
  font-weight: 600;
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
`

export const BalanceInfo = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
  margin-bottom: 22px;

  span {
    font-size: 12px;
    color: ${({ theme }) => theme.colors.themeColors[200]};
    font-family: 'Inter', sans-serif;
  }
`

export const MaxButton = styled.button`
  border: none;
  background: transparent;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  cursor: pointer;
  font-size: 12px;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  padding: 0;

  &:hover {
    color: ${({ theme }) => theme.colors.themeColors[800]};
  }
`

export const WarningBox = styled.div`
  background: ${({ theme }) => theme.colors.themeColors[600]};
  border: 1px solid ${({ theme }) => theme.colors.themeColors[400]};
  padding: 14px 16px;
  border-radius: 12px;
  margin-bottom: 14px;

  p {
    margin: 0;
    font-size: 13px;
    color: ${({ theme }) => theme.colors.themeColors[100]};
    line-height: 1.65;
    font-family: 'Inter', sans-serif;
  }
`

export const ErrorBox = styled.div`
  background: rgba(255, 75, 85, 0.12);
  border: 1px solid rgba(255, 75, 85, 0.35);
  color: #ffd8dc;
  border-radius: 12px;
  padding: 12px 14px;
  margin-bottom: 22px;
  font-size: 13px;
  line-height: 1.55;
  font-family: 'Inter', sans-serif;
`

export const Actions = styled.div`
  display: flex;
  gap: 12px;

  @media (max-width: 480px) {
    flex-direction: column;
  }
`

export const Button = styled.button<{ primary?: boolean }>`
  flex: 1;
  padding: 14px 16px;
  border-radius: 12px;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.2s;
  
  background: ${({ primary, theme }) => primary ? theme.colors.themeColors[800] : theme.colors.themeColors[600]};
  color: #ffffff;
  border: ${({ primary, theme }) => primary ? 'none' : `1px solid ${theme.colors.themeColors[400]}`};

  &:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }
`
