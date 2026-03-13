import styled, { css } from 'styled-components'

export const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
`

export const Title = styled.h1`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 32px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  margin: 0;
`

export const Subtitle = styled.p`
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
  margin: 8px 0 0 0;
`

export const LeaderboardContainer = styled.div`
  background: ${({ theme }) => theme.colors.themeColors[600]};
  border-radius: 16px;
  padding: 16px;
  margin-top: 24px;
  overflow: hidden;
`

export const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  text-align: left;
`

export const Th = styled.th`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.themeColors[200]};
  padding: 12px 16px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.themeColors[400]};
`

export const Td = styled.td`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  padding: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);

  &:last-child {
    text-align: right;
  }
`

export const Tr = styled.tr`
  transition: background 0.2s;
  &:hover {
    background: rgba(255, 255, 255, 0.02);
  }
`

export const LeaderInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

export const Avatar = styled.div<{ isAI?: boolean }>`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: ${({ isAI }) => isAI ? 'linear-gradient(135deg, #1fff8e 0%, #17b36f 100%)' : 'linear-gradient(135deg, #6c38fe 0%, #4a1bb3 100%)'};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: #fff;
  font-family: 'Inter', sans-serif;
  font-weight: bold;
`

export const LeaderName = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;

  span {
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  small {
    color: ${({ theme }) => theme.colors.themeColors[200]};
    font-size: 12px;
    font-family: 'Inter', sans-serif;
  }
`

export const AIBadge = styled.span`
  background: rgba(38, 208, 124, 0.15);
  color: #26d07c;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
`

export const ROI = styled.span<{ value: number }>`
  color: ${({ value }) => value >= 0 ? '#26d07c' : '#ff4b55'};
  font-weight: 600;
`

export const StatBox = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;

  span {
    color: ${({ theme }) => theme.colors.themeColors[100]};
    font-weight: 600;
  }

  small {
    color: ${({ theme }) => theme.colors.themeColors[200]};
    font-size: 12px;
  }
`

export const ActionButton = styled.button`
  background: ${({ theme }) => theme.colors.themeColors[800]};
  border: 1px solid ${({ theme }) => theme.colors.themeColors[400]};
  border-radius: 8px;
  padding: 8px 16px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: ${({ theme }) => theme.colors.themeColors[400]};
  }
`

export const SetupButton = styled(ActionButton)`
  background: transparent;
  border-color: #6c38fe;
  color: #6c38fe;

  &:hover {
    background: rgba(108, 56, 254, 0.1);
  }
`
