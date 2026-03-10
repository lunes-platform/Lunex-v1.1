import styled from "styled-components"
import device from "../devices/devices"

export const GlowBox = styled.div<{ maxWidth?: string }>`
  background: ${({ theme }) => theme.colors.themeColors[500]};
  border-radius: 16px;
  padding: 24px;
  width: 100%;
  max-width: ${(props) => props.maxWidth || "592px"};
  display: flex;
  flex-direction: column;
  gap: 16px;
  position: relative;
  z-index: 2;
  overflow-y: auto;
  max-height: calc(100vh - 200px);
  box-shadow: 0px 0px 500px -70px #6c38fe;
  animation: pulse 1s infinite;

  @keyframes pulse {
    0% {
      -moz-box-shadow: 0px 0px 500px -60px #6c38fe;
      box-shadow: 0px 0px 500px -60px #6c38fe;
    }
    50% {
      -moz-box-shadow: 0px 0px 500px -70px #6c38fe;
      box-shadow: 0px 0px 500px -70px #6c38fe;
    }
    100% {
      -moz-box-shadow: 0px 0px 250px -60px #6c38fe;
      box-shadow: 0px 0px 250px -60px #6c38fe;
    }
  }


  ${device.laptop} {
    min-height: auto;
  }
  ${device.mobileL} {
    min-height: auto;
    padding: 16px 16px 24px;
  }

  /* Pools page requires wider container */
  @media (max-width: 1000px) {
    width: 100%;
  }
`

export const PageFooter = styled.p`
  padding: 16px;
  color: #fff;
  opacity: 0.5;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  text-align: center;
  font-weight: 500;
  max-width: 500px;
  margin: 0 auto;
`
