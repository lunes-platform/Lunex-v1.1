import React from 'react'
import styled, { keyframes } from 'styled-components'

const fadeSlideIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 0.5;
    transform: translateY(0);
  }
`

const FooterText = styled.p`
  padding: 16px;
  color: #fff;
  opacity: 0;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  text-align: center;
  font-weight: 500;
  max-width: 500px;
  margin: 0 auto;
  position: relative;
  z-index: 10;
  animation: ${fadeSlideIn} 0.6s ease-out 0.3s forwards;

  strong {
    color: ${({ theme }) => theme.colors.themeColors[800]};
  }
`

const FooterTag: React.FC = () => (
  <FooterText>
    <strong>Lunex:</strong> Developed with 💜 on the Lunes blockchain
  </FooterText>
)

export default FooterTag
