import React from 'react'
import styled, { keyframes } from 'styled-components'

const shimmer = keyframes`
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
`

const SkeletonBase = styled.div<{
  $width?: string
  $height?: string
  $radius?: string
}>`
  width: ${({ $width }) => $width || '100%'};
  height: ${({ $height }) => $height || '20px'};
  border-radius: ${({ $radius }) => $radius || '8px'};
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.05) 25%,
    rgba(255, 255, 255, 0.1) 50%,
    rgba(255, 255, 255, 0.05) 75%
  );
  background-size: 200% 100%;
  animation: ${shimmer} 1.5s infinite linear;
`

export const SkeletonBox: React.FC<{
  width?: string
  height?: string
  radius?: string
}> = ({ width, height, radius }) => (
  <SkeletonBase $width={width} $height={height} $radius={radius} />
)

const CardSkeletonWrapper = styled.div`
  background: #232323;
  border: 1px solid #2a2a2c;
  border-radius: 16px;
  padding: 24px;
`
const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
`
const MetricsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin: 16px 0;
`
const ActionsRow = styled.div`
  display: flex;
  gap: 12px;
  margin-top: 24px;
`

export const TraderCardSkeleton: React.FC = () => (
  <CardSkeletonWrapper>
    <Row>
      <SkeletonBase $width="56px" $height="56px" $radius="50%" />
      <div style={{ flex: 1 }}>
        <SkeletonBase $width="60%" $height="24px" $radius="6px" />
        <SkeletonBase
          $width="40%"
          $height="14px"
          $radius="6px"
          style={{ marginTop: '8px' }}
        />
      </div>
    </Row>
    <SkeletonBase
      $width="100%"
      $height="40px"
      $radius="6px"
      style={{ marginBottom: '16px' }}
    />
    <SkeletonBase $width="100%" $height="56px" $radius="8px" />
    <MetricsGrid>
      <SkeletonBase $height="40px" $radius="8px" />
      <SkeletonBase $height="40px" $radius="8px" />
      <SkeletonBase $height="40px" $radius="8px" />
      <SkeletonBase $height="40px" $radius="8px" />
    </MetricsGrid>
    <ActionsRow>
      <SkeletonBase $height="40px" $radius="8px" />
      <SkeletonBase $height="40px" $radius="8px" />
    </ActionsRow>
  </CardSkeletonWrapper>
)
