import styled, { css } from 'styled-components'
import device from 'components/devices/devices'

export const SpotWrapper = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  gap: 4px;
`

export const PairBar = styled.div`
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 12px 16px;
  background: #181818;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
`

export const MainGrid = styled.div`
  display: flex;
  flex: 1;
  gap: 4px;
  min-height: 0;

  ${device.mobileL} {
    flex-direction: column;
  }
`

export const ChartCol = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 4px;
  min-width: 0;
`

export const RightCol = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 260px;
  flex-shrink: 0;

  ${device.mobileL} {
    width: 100%;
  }
`

export const BottomPanel = styled.div`
  background: #181818;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
  min-height: 200px;
`

export const Card = styled.div`
  background: #181818;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  overflow: hidden;
`
