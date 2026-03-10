import styled, { keyframes } from 'styled-components'

// === ANIMATIONS ===
export const fadeInUp = keyframes`
  from { opacity: 0; transform: translateY(24px); }
  to { opacity: 1; transform: translateY(0); }
`
export const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`
export const floatY = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-12px); }
`
export const shimmer = keyframes`
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
`
export const gradientShift = keyframes`
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
`
export const auroraRotate = keyframes`
  0% { transform: rotate(0deg) scale(1.5); }
  50% { transform: rotate(180deg) scale(2); }
  100% { transform: rotate(360deg) scale(1.5); }
`

interface Anim { $delay?: string }

// === LAYOUT ===
export const Page = styled.div`
  min-height: 100vh;
  background: ${({ theme }) => theme.colors.neutral[600]};
  color: ${({ theme }) => theme.colors.themeColors[100]};
  overflow-x: hidden;
  position: relative;
  font-family: 'Space Grotesk', sans-serif;

  &::before {
    content: '';
    position: fixed;
    inset: 0;
    background: radial-gradient(circle at 50% -20%, rgba(108,56,255,0.08) 0%, transparent 60%);
    pointer-events: none;
    z-index: 1;
  }
  
  &::after {
    content: '';
    position: fixed;
    inset: 0;
    background: url("data:image/svg+xml,%3Csvg width='4' height='4' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='1' height='1' fill='%23ffffff' opacity='0.02'/%3E%3C/svg%3E") repeat;
    pointer-events: none;
    z-index: 2;
  }
`

// === NAV ===
export const Nav = styled.nav<{ $scrolled?: boolean }>`
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 100;
  padding: 0 40px;
  height: 64px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: ${p => p.$scrolled ? 'rgba(11,9,9,0.75)' : 'transparent'};
  backdrop-filter: ${p => p.$scrolled ? 'blur(16px)' : 'none'};
  -webkit-backdrop-filter: ${p => p.$scrolled ? 'blur(16px)' : 'none'};
  border-bottom: 1px solid ${p => p.$scrolled ? `rgba(255,255,255,0.05)` : 'transparent'};
  transition: all 0.3s ease;
  @media (max-width: 768px) { padding: 0 16px; }
`
export const Logo = styled.div`
  display: flex; align-items: center;
  img { height: 28px; width: auto; }
`
export const NavLinks = styled.div`
  display: flex; align-items: center; gap: 32px;
  @media (max-width: 768px) { display: none; }
`
export const NavLink = styled.a`
  color: ${({ theme }) => theme.colors.themeColors[200]};
  text-decoration: none;
  font-size: 14px; font-weight: 500;
  letter-spacing: 0.02em;
  transition: color 0.2s;
  &:hover { color: ${({ theme }) => theme.colors.themeColors[100]}; }
`
export const ConnectBtn = styled.button`
  background: linear-gradient(135deg, ${({ theme }) => theme.colors.primary[500]} 0%, ${({ theme }) => theme.colors.primary[400]} 100%);
  color: #fff;
  border: none;
  padding: 8px 20px;
  border-radius: 8px;
  font-size: 13px; font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(108,56,255,0.4);
    filter: none;
  }
  &:active {
    transform: translateY(0) scale(0.96);
  }
`

// === HERO ===
export const HeroSection = styled.section`
  min-height: 100vh;
  display: flex; align-items: center;
  padding: 100px 40px 60px;
  position: relative; z-index: 2;
  &::before {
    content: '';
    position: absolute;
    top: -10%; left: 0%;
    width: 60%; height: 60%;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(108,56,255,0.15) 0%, transparent 70%);
    pointer-events: none;
    filter: blur(80px);
    animation: ${auroraRotate} 20s linear infinite;
    z-index: -1;
  }

  &::after {
    content: '';
    position: absolute;
    right: -10%;
    bottom: 0%;
    width: 50%;
    height: 50%;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(38,208,124,0.1) 0%, transparent 70%);
    pointer-events: none;
    filter: blur(80px);
    animation: ${auroraRotate} 25s linear infinite reverse;
    z-index: -1;
  }

  @media (max-width: 968px) { padding: 100px 16px 40px; }
`
export const HeroGrid = styled.div`
  max-width: 1200px; width: 100%; margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 80px; align-items: center;
  @media (max-width: 968px) {
    grid-template-columns: 1fr; gap: 40px; text-align: center;
  }
`
export const HeroContent = styled.div`
  display: flex; flex-direction: column; align-items: flex-start;
  max-width: 560px;
  position: relative;
  padding: 28px 28px 24px;
  border-radius: 28px;
  background: linear-gradient(180deg, rgba(24,24,28,0.5) 0%, rgba(15,15,18,0.18) 100%);
  border: 1px solid rgba(255,255,255,0.05);
  box-shadow: 0 28px 60px rgba(0,0,0,0.18), 0 0 0 1px rgba(255,255,255,0.02) inset;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at top left, rgba(108,56,255,0.14) 0%, transparent 42%);
    pointer-events: none;
  }

  @media (max-width: 968px) { align-items: center; }

  @media (max-width: 968px) {
    padding: 24px 20px;
  }
`
export const HeroBadge = styled.div<Anim>`
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 14px;
  border: 1px solid ${({ theme }) => theme.colors.primary[700]};
  border-radius: 20px;
  font-size: 12px; font-weight: 600;
  color: ${({ theme }) => theme.colors.primary[400]};
  text-transform: uppercase; letter-spacing: 0.08em;
  margin-bottom: 24px;
  opacity: 0;
  animation: ${fadeInUp} 0.6s cubic-bezier(0.22,1,0.36,1) forwards;
  animation-delay: ${p => p.$delay || '0s'};
`
export const HeroTitle = styled.h1<Anim>`
  font-size: clamp(42px, 5.5vw, 72px);
  font-weight: 700; line-height: 1.05;
  letter-spacing: -0.03em;
  margin-bottom: 24px;
  opacity: 0;
  animation: ${fadeInUp} 0.7s cubic-bezier(0.22,1,0.36,1) forwards;
  animation-delay: ${p => p.$delay || '0.1s'};
  span {
    background: linear-gradient(135deg, ${({ theme }) => theme.colors.primary[400]} 0%, ${({ theme }) => theme.colors.primary[200]} 50%, ${({ theme }) => theme.colors.success[400]} 100%);
    background-size: 200% 200%;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: ${gradientShift} 8s ease infinite;
  }
`
export const HeroSub = styled.p<Anim>`
  font-size: 17px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
  max-width: 560px; line-height: 1.7;
  margin-bottom: 28px;
  opacity: 0;
  animation: ${fadeInUp} 0.7s cubic-bezier(0.22,1,0.36,1) forwards;
  animation-delay: ${p => p.$delay || '0.2s'};
  @media (max-width: 968px) { margin-left: auto; margin-right: auto; }
`
export const HeroBtns = styled.div<Anim>`
  display: flex; gap: 16px; flex-wrap: wrap;
  opacity: 0;
  animation: ${fadeInUp} 0.7s cubic-bezier(0.22,1,0.36,1) forwards;
  animation-delay: ${p => p.$delay || '0.3s'};
  @media (max-width: 968px) { justify-content: center; }
`
export const HeroMetricRow = styled.div<Anim>`
  width: 100%;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-top: 20px;
  opacity: 0;
  animation: ${fadeInUp} 0.7s cubic-bezier(0.22,1,0.36,1) forwards;
  animation-delay: ${p => p.$delay || '0.32s'};

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`
export const HeroMetricCard = styled.div`
  padding: 16px 14px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
  border: 1px solid rgba(255,255,255,0.07);
  box-shadow: 0 14px 28px rgba(0,0,0,0.12);
  text-align: left;
`
export const HeroMetricValue = styled.div`
  font-size: 20px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  margin-bottom: 6px;
`
export const HeroMetricLabel = styled.div`
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: ${({ theme }) => theme.colors.themeColors[300]};
`
export const HeroProofGrid = styled.div<Anim>`
  width: 100%;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 24px;
  opacity: 0;
  animation: ${fadeInUp} 0.7s cubic-bezier(0.22,1,0.36,1) forwards;
  animation-delay: ${p => p.$delay || '0.35s'};

  @media (max-width: 968px) {
    max-width: 560px;
  }

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`
export const HeroProofCard = styled.div`
  background: linear-gradient(180deg, rgba(34,34,40,0.72) 0%, rgba(22,22,26,0.52) 100%);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 20px;
  padding: 16px;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  position: relative;
  overflow: hidden;
  min-height: 112px;

  &::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 2px;
    background: linear-gradient(90deg, rgba(108,56,255,0.15) 0%, rgba(108,56,255,0.6) 50%, rgba(38,208,124,0.25) 100%);
    opacity: 0.9;
  }

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at top right, rgba(108,56,255,0.1) 0%, transparent 38%);
    pointer-events: none;
  }

  &:hover {
    transform: translateY(-6px);
    border-color: rgba(108,56,255,0.38);
    box-shadow: 0 18px 30px rgba(0,0,0,0.28), 0 0 24px rgba(108,56,255,0.08) inset;
  }
`
export const HeroProofIcon = styled.div`
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(108,56,255,0.12);
  color: ${({ theme }) => theme.colors.primary[400]};

  svg {
    width: 18px;
    height: 18px;
  }
`
export const HeroProofContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`
export const HeroProofTitle = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.themeColors[100]};
`
export const HeroProofNote = styled.div`
  font-size: 12px;
  line-height: 1.6;
  color: ${({ theme }) => theme.colors.themeColors[300]};
`
export const PrimaryBtn = styled.button`
  background: linear-gradient(135deg, ${({ theme }) => theme.colors.primary[600]} 0%, ${({ theme }) => theme.colors.primary[500]} 100%);
  color: #fff;
  border: none;
  padding: 14px 32px;
  border-radius: 12px;
  font-size: 15px; font-weight: 700;
  cursor: pointer;
  display: flex; align-items: center; gap: 10px;
  transition: transform 0.2s, box-shadow 0.2s;
  position: relative; overflow: hidden;

  &::after {
    content: '';
    position: absolute;
    top: 0; left: -100%;
    width: 100%; height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent);
    animation: ${shimmer} 3s infinite;
  }

  &:hover {
    transform: translateY(-3px);
    box-shadow: 0 12px 30px rgba(108,56,255,0.5);
    filter: none;
  }
  &:active {
    transform: translateY(0) scale(0.97);
  }
  svg { width: 18px; height: 18px; }
`
export const SecBtn = styled.button`
  background: rgba(255,255,255,0.03);
  color: ${({ theme }) => theme.colors.themeColors[100]};
  border: 1px solid rgba(255,255,255,0.1);
  padding: 14px 32px;
  border-radius: 12px;
  font-size: 15px; font-weight: 600;
  cursor: pointer;
  display: flex; align-items: center; gap: 10px;
  backdrop-filter: blur(4px);
  transition: all 0.2s;
  &:hover {
    border-color: ${({ theme }) => theme.colors.primary[500]};
    background: rgba(255,255,255,0.08);
    transform: translateY(-3px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    filter: none;
  }
  &:active {
    transform: translateY(0) scale(0.97);
  }
  svg { width: 16px; height: 16px; opacity: 0.7; }
`

// === SWAP PREVIEW ===
export const SwapPreview = styled.div<Anim>`
  background: rgba(30, 30, 34, 0.4);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 24px;
  padding: 28px;
  position: relative;
  opacity: 0;
  animation: ${fadeInUp} 0.8s cubic-bezier(0.22,1,0.36,1) forwards;
  animation-delay: ${p => p.$delay || '0.4s'};
  max-width: 420px; width: 100%;
  box-shadow: 0 32px 64px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.02) inset;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 24px;
    right: 24px;
    height: 2px;
    background: linear-gradient(90deg, ${({ theme }) => theme.colors.primary[400]} 0%, ${({ theme }) => theme.colors.success[400]} 100%);
    opacity: 0.9;
  }

  &::after {
    content: '';
    position: absolute;
    inset: 14px;
    border-radius: 18px;
    border: 1px solid rgba(255,255,255,0.03);
    pointer-events: none;
  }

  @media (max-width: 968px) { margin: 0 auto; }
`
export const SwapHeader = styled.div`
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 24px;
  h3 { font-size: 16px; font-weight: 600; }
  span { font-size: 12px; color: ${({ theme }) => theme.colors.themeColors[300]}; }
`
export const SwapTopStats = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 16px;
`
export const SwapTopStat = styled.div`
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.05);

  strong {
    display: block;
    font-size: 15px;
    font-weight: 700;
    color: ${({ theme }) => theme.colors.themeColors[100]};
    margin-bottom: 4px;
  }

  span {
    font-size: 11px;
    color: ${({ theme }) => theme.colors.themeColors[300]};
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
`
export const SwapField = styled.div<{ $active?: boolean }>`
  background: rgba(255,255,255,0.03);
  border: 1px solid ${p => p.$active ? `rgba(108,56,255,0.3)` : 'rgba(255,255,255,0.05)'};
  border-radius: 16px;
  padding: 16px;
  margin-bottom: 8px;
  display: flex; justify-content: space-between; align-items: center;
`
export const SwapFieldLeft = styled.div`
  display: flex; align-items: center; gap: 10px;
  img { width: 28px; height: 28px; border-radius: 50%; }
  span { font-weight: 600; font-size: 15px; }
`
export const SwapFieldRight = styled.div`
  text-align: right;
  .amount { font-size: 22px; font-weight: 700; }
  .usd { font-size: 12px; color: ${({ theme }) => theme.colors.themeColors[300]}; margin-top: 2px; }
`
export const SwapArrow = styled.div`
  display: flex; justify-content: center;
  margin: -4px 0; position: relative; z-index: 2;
  div {
    width: 36px; height: 36px;
    background: ${({ theme }) => theme.colors.neutral[800]};
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    color: ${({ theme }) => theme.colors.primary[400]};
    svg { width: 16px; height: 16px; }
  }
`
export const SwapButton = styled.div`
  background: linear-gradient(135deg, ${({ theme }) => theme.colors.primary[600]} 0%, ${({ theme }) => theme.colors.primary[500]} 100%);
  color: #fff;
  border: none;
  padding: 14px;
  border-radius: 12px;
  font-size: 15px; font-weight: 700;
  text-align: center;
  margin-top: 16px;
  box-shadow: 0 10px 24px rgba(108,56,255,0.2);
  transition: all 0.2s;
  cursor: pointer;
  
  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 14px 28px rgba(108,56,255,0.4);
  }
  &:active {
    transform: translateY(0) scale(0.98);
  }
`
export const SwapInfo = styled.div`
  display: flex; justify-content: space-between;
  margin-top: 12px;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.themeColors[300]};
`

// === STATS ===
export const StatsBar = styled.section<Anim>`
  padding: 40px;
  opacity: 0;
  &.in-view {
    animation: ${fadeIn} 0.8s ease forwards;
    animation-delay: ${p => p.$delay || '0.6s'};
  }
  position: relative; z-index: 2;
  border-top: 1px solid rgba(255,255,255,0.04);
  border-bottom: 1px solid rgba(255,255,255,0.04);
  background: linear-gradient(180deg, rgba(20,20,22,0.78) 0%, rgba(26,26,26,0.48) 100%);
  backdrop-filter: blur(14px);

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, rgba(108,56,255,0.04) 0%, transparent 35%, transparent 65%, rgba(38,208,124,0.03) 100%);
    pointer-events: none;
  }

  @media (max-width: 768px) { padding: 32px 16px; }
`
export const StatsGrid = styled.div`
  max-width: 1200px; margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 32px;
  @media (max-width: 768px) { grid-template-columns: repeat(2, 1fr); gap: 24px; }
  @media (max-width: 480px) { grid-template-columns: 1fr; }
`
export const StatItem = styled.div`
  text-align: center;
  padding: 24px;
  background: linear-gradient(180deg, rgba(32,32,36,0.58) 0%, rgba(20,20,22,0.38) 100%);
  border-radius: 20px;
  border: 1px solid rgba(255,255,255,0.05);
  box-shadow: 0 14px 30px rgba(0,0,0,0.14);
  transition: all 0.3s;
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 18px;
    right: 18px;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent);
    opacity: 0.32;
  }

  &:hover {
    transform: translateY(-4px);
    border-color: ${({ theme }) => theme.colors.primary[700]};
    box-shadow: 0 20px 40px rgba(0,0,0,0.2), 0 0 0 1px rgba(108,56,255,0.08) inset;
  }
`
export const StatVal = styled.div`
  font-size: 32px; font-weight: 700;
  letter-spacing: -0.02em;
  background: linear-gradient(135deg, #fff 0%, ${({ theme }) => theme.colors.themeColors[200]} 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
`
export const StatLabel = styled.div`
  font-size: 12px; font-weight: 500;
  text-transform: uppercase; letter-spacing: 0.08em;
  color: ${({ theme }) => theme.colors.themeColors[300]};
  margin-top: 4px;
`

// === SECTION HELPERS ===
export const Section = styled.section`
  padding: 120px 40px;
  max-width: 1200px; margin: 0 auto;
  position: relative; z-index: 2;
  @media (max-width: 768px) { padding: 80px 16px; }
`
export const STitle = styled.h2`
  font-size: clamp(28px, 4vw, 44px);
  font-weight: 700; text-align: center;
  margin-bottom: 16px; letter-spacing: -0.02em;
  span { color: ${({ theme }) => theme.colors.primary[400]}; }
`
export const SSub = styled.p`
  font-size: 16px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
  text-align: center;
  max-width: 520px;
  margin: 0 auto 64px;
  line-height: 1.6;
`

// === FEATURES ===
export const FeatGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
  @media (max-width: 968px) { grid-template-columns: repeat(2, 1fr); }
  @media (max-width: 600px) { grid-template-columns: 1fr; }
`
export const FeatCard = styled.div<Anim>`
  background: rgba(30,30,34,0.3);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.05);
  border-radius: 24px;
  padding: 36px 28px;
  opacity: 0;
  &.in-view {
    animation: ${fadeInUp} 0.6s cubic-bezier(0.22,1,0.36,1) forwards;
    animation-delay: ${p => p.$delay || '0s'};
  }
  transition: all 0.4s cubic-bezier(0.175,0.885,0.32,1.275);
  position: relative;
  overflow: hidden;

  /* Ambient top shine */
  &::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
    opacity: 0.1;
    transition: opacity 0.4s;
  }

  &:hover {
    border-color: rgba(108,56,255,0.3);
    background: rgba(40,40,45,0.5);
    transform: translateY(-8px) scale(1.02);
    box-shadow: 0 24px 48px rgba(0,0,0,0.3), 0 0 30px rgba(108,56,255,0.1) inset;
    
    &::before { opacity: 0.6; }
  }
`
export const FeatIcon = styled.div`
  width: 56px; height: 56px;
  background: rgba(108,56,255,0.15);
  border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 20px;
  color: ${({ theme }) => theme.colors.primary[400]};
  transition: all 0.4s;
  
  ${FeatCard}:hover & {
    background: rgba(108,56,255,0.25);
    transform: scale(1.1) rotate(5deg);
    box-shadow: 0 0 20px rgba(108,56,255,0.2);
  }

  svg { width: 28px; height: 28px; }
`
export const FeatTitle = styled.h3`
  font-size: 20px; font-weight: 700; margin-bottom: 10px;
`
export const FeatDesc = styled.p`
  font-size: 15px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
  line-height: 1.7;
`

// === HIGHLIGHTS ===
export const HLGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 24px;
  @media (max-width: 900px) { grid-template-columns: repeat(2, 1fr); }
  @media (max-width: 500px) { grid-template-columns: 1fr; }
`
export const HLCard = styled.div<Anim & { $accent?: string }>`
  background: rgba(30,30,34,0.4);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.05);
  border-radius: 20px;
  padding: 32px 24px;
  text-align: center;
  opacity: 0;
  &.in-view {
    animation: ${fadeInUp} 0.6s ease forwards;
    animation-delay: ${p => p.$delay || '0s'};
  }
  transition: all 0.4s cubic-bezier(0.175,0.885,0.32,1.275);
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 0; left: 20%; right: 20%;
    height: 3px;
    background: ${p => p.$accent || '#6C38FF'};
    border-radius: 0 0 4px 4px;
    transition: all 0.4s;
  }
  
  /* Radial glow behind the card on hover */
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 50% 0%, ${p => p.$accent ? `${p.$accent}20` : 'rgba(108,56,255,0.1)'}, transparent 70%);
    opacity: 0;
    transition: opacity 0.4s;
    z-index: -1;
  }

  &:hover {
    transform: translateY(-8px) scale(1.02);
    border-color: ${p => p.$accent ? `${p.$accent}40` : 'rgba(108,56,255,0.4)'};
    box-shadow: 0 20px 40px rgba(0,0,0,0.4);
    
    &::before {
      left: 0; right: 0;
      box-shadow: 0 0 20px ${p => p.$accent || '#6C38FF'};
    }
    
    &::after {
      opacity: 1;
    }
  }
`
export const HLVal = styled.div`
  font-size: 48px; font-weight: 800;
  letter-spacing: -0.02em; margin-bottom: 8px;
`
export const HLLabel = styled.div`
  font-size: 13px;
  text-transform: uppercase; letter-spacing: 0.05em;
  color: ${({ theme }) => theme.colors.themeColors[200]};
`
export const HLDesc = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.themeColors[300]};
  margin-top: 16px; line-height: 1.5;
`

// === COMPARISON ===
export const CompSection = styled.section`
  padding: 120px 40px;
  max-width: 1200px; margin: 0 auto;
  position: relative; z-index: 2;
  @media (max-width: 768px) { padding: 80px 16px; }
`
export const CompTable = styled.div`
  background: linear-gradient(180deg, rgba(27,27,31,0.72) 0%, rgba(20,20,22,0.52) 100%);
  border-radius: 24px;
  border: 1px solid rgba(255,255,255,0.05);
  overflow: hidden;
  margin-top: 60px;
  box-shadow: 0 28px 60px rgba(0,0,0,0.22);
  position: relative;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 24px;
    right: 24px;
    height: 1px;
    background: linear-gradient(90deg, rgba(108,56,255,0) 0%, rgba(108,56,255,0.38) 40%, rgba(38,208,124,0.2) 100%);
    z-index: 1;
  }
`
export const CompHead = styled.div`
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr 1fr;
  padding: 20px 32px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  background: rgba(108,56,255,0.08);
  @media (max-width: 768px) { grid-template-columns: 1.5fr 1fr 1fr 1fr 1fr; padding: 16px 20px; }
`
export const CompHCell = styled.div`
  font-size: 14px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.05em;
  color: ${({ theme }) => theme.colors.themeColors[200]};
  &:first-child { color: #fff; }
  @media (max-width: 768px) { font-size: 11px; }
`
export const CompRow = styled.div<{ $hl?: boolean }>`
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr 1fr;
  padding: 24px 32px;
  border-bottom: 1px solid rgba(255,255,255,0.03);
  background: ${p => p.$hl ? 'linear-gradient(90deg, rgba(108,56,255,0.12) 0%, rgba(108,56,255,0.05) 45%, rgba(38,208,124,0.04) 100%)' : 'transparent'};
  transition: background 0.2s, transform 0.2s;
  position: relative;

  &:hover {
    background: linear-gradient(90deg, rgba(108,56,255,0.08) 0%, rgba(108,56,255,0.03) 100%);
    transform: translateX(2px);
  }

  &:last-child { border-bottom: none; }
  @media (max-width: 768px) { grid-template-columns: 1.5fr 1fr 1fr 1fr 1fr; padding: 16px 20px; }
`
export const CompCell = styled.div<{ $green?: boolean }>`
  font-size: 15px;
  color: ${p => p.$green ? ({ theme }) => theme.colors.success[400] : ({ theme }) => theme.colors.themeColors[200]};
  display: flex; align-items: center; gap: 8px;
  &:first-child { font-weight: 600; color: #fff; }
  svg { width: 18px; height: 18px; }
  @media (max-width: 768px) { font-size: 13px; }
`
export const DexName = styled.div<{ $main?: boolean }>`
  display: flex; align-items: center; gap: 12px;
  img { width: 32px; height: 32px; border-radius: 50%; }
  span { font-weight: 700; color: ${p => p.$main ? ({ theme }) => theme.colors.primary[400] : '#fff'}; }
  @media (max-width: 768px) { gap: 8px; img { width: 24px; height: 24px; } }
`

// === ECOSYSTEM ===
export const EcoGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 20px;
  @media (max-width: 1000px) { grid-template-columns: repeat(3, 1fr); }
  @media (max-width: 600px) { grid-template-columns: repeat(2, 1fr); }
`
export const EcoCard = styled.div<Anim>`
  background: linear-gradient(180deg, rgba(34,34,38,0.5) 0%, rgba(24,24,28,0.32) 100%);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.05);
  border-radius: 20px;
  padding: 32px 20px;
  text-align: center;
  opacity: 0;
  &.in-view {
    animation: ${fadeInUp} 0.5s ease forwards;
    animation-delay: ${p => p.$delay || '0s'};
  }
  transition: all 0.4s cubic-bezier(0.175,0.885,0.32,1.275);
  cursor: pointer;
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at center, rgba(108,56,255,0.1) 0%, transparent 60%);
    opacity: 0;
    transition: opacity 0.4s;
    z-index: -1;
  }

  &::after {
    content: '';
    position: absolute;
    top: 0;
    left: 18px;
    right: 18px;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent);
    opacity: 0.25;
    transition: opacity 0.4s;
  }

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary[600]};
    transform: translateY(-5px) scale(1.03);
    box-shadow: 0 22px 40px rgba(0,0,0,0.32), 0 0 24px rgba(108,56,255,0.08) inset;

    &::before { opacity: 1; }
    &::after { opacity: 0.65; }

    svg {
      transform: scale(1.1);
      filter: drop-shadow(0 0 8px currentColor);
    }
  }
  svg, img { 
    margin-bottom: 20px; 
    transition: all 0.3s;
  }
  h4 { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
  p { font-size: 14px; color: ${({ theme }) => theme.colors.themeColors[200]}; line-height: 1.6; }
`

// === HOW IT WORKS ===
export const StepsWrap = styled.div`
  max-width: 900px; margin: 0 auto;
  position: relative;
  &::before {
    content: '';
    position: absolute;
    left: 40px; top: 20px; bottom: 20px;
    width: 2px;
    background: linear-gradient(180deg, ${({ theme }) => theme.colors.primary[600]} 0%, rgba(108,56,255,0.1) 100%);
    @media (max-width: 600px) { left: 24px; }
  }
`
export const Step = styled.div<Anim>`
  display: flex; gap: 40px;
  margin-bottom: 60px;
  opacity: 0;
  &.in-view {
    animation: ${fadeInUp} 0.6s ease forwards;
    animation-delay: ${p => p.$delay || '0s'};
  }
  &:last-child { margin-bottom: 0; }
  align-items: flex-start;
  @media (max-width: 600px) { gap: 24px; }
`
export const StepNum = styled.div`
  width: 80px; height: 80px; min-width: 80px;
  background: radial-gradient(circle at 30% 30%, rgba(108,56,255,0.24) 0%, ${({ theme }) => theme.colors.neutral[800]} 72%);
  border: 2px solid ${({ theme }) => theme.colors.primary[600]};
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 24px; font-weight: 800;
  color: ${({ theme }) => theme.colors.primary[400]};
  position: relative; z-index: 2;
  box-shadow: 0 0 0 8px ${({ theme }) => theme.colors.neutral[900]};
  @media (max-width: 600px) { width: 48px; height: 48px; min-width: 48px; font-size: 18px; }
`
export const StepBody = styled.div`
  padding: 18px 22px 20px;
  background: linear-gradient(180deg, rgba(34,34,38,0.46) 0%, rgba(24,24,28,0.24) 100%);
  border: 1px solid rgba(255,255,255,0.05);
  border-radius: 22px;
  box-shadow: 0 18px 36px rgba(0,0,0,0.16);
  h3 { font-size: 24px; font-weight: 700; margin-bottom: 12px; }
  p { font-size: 16px; color: ${({ theme }) => theme.colors.themeColors[200]}; line-height: 1.7; }
  @media (max-width: 600px) { h3 { font-size: 20px; } p { font-size: 14px; } }
`

// === CTA ===
export const CTASection = styled.section`
  padding: 40px 40px 120px;
  position: relative; z-index: 2;
  @media (max-width: 768px) { padding: 40px 16px 80px; }
`
export const CTACard = styled.div`
  max-width: 900px; margin: 0 auto;
  background: linear-gradient(135deg, rgba(108,56,255,0.15) 0%, rgba(26,26,26,0.8) 100%);
  border: 1px solid ${({ theme }) => theme.colors.primary[800]};
  border-radius: 32px;
  padding: 80px 40px;
  text-align: center;
  position: relative; overflow: hidden;
  box-shadow: 0 40px 80px rgba(0,0,0,0.24), 0 0 0 1px rgba(255,255,255,0.03) inset;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 20% 20%, rgba(108,56,255,0.22) 0%, transparent 35%), radial-gradient(circle at 80% 0%, rgba(38,208,124,0.12) 0%, transparent 30%);
    pointer-events: none;
  }

  &::after {
    content: '';
    position: absolute;
    top: 0;
    left: 40px;
    right: 40px;
    height: 1px;
    background: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.28) 50%, rgba(255,255,255,0) 100%);
    opacity: 0.7;
  }

  @media (max-width: 768px) { padding: 48px 20px; }
`
export const CTATitle = styled.h2`
  font-size: clamp(28px, 4vw, 44px);
  font-weight: 800;
  margin-bottom: 24px;
  letter-spacing: -0.02em;
  position: relative;
  z-index: 1;
`
export const CTADesc = styled.p`
  font-size: 20px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
  margin-bottom: 40px;
  max-width: 600px;
  margin-left: auto; margin-right: auto;
  line-height: 1.7;
  position: relative;
  z-index: 1;
`

// === FOOTER ===
export const Footer = styled.footer`
  padding: 80px 40px 40px;
  background: ${({ theme }) => theme.colors.neutral[800]};
  border-top: 1px solid rgba(255,255,255,0.05);
  position: relative; z-index: 2;
  @media (max-width: 768px) { padding: 40px 16px 24px; }
`
export const FooterGrid = styled.div`
  max-width: 1200px; margin: 0 auto;
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr; gap: 60px;
  @media (max-width: 768px) { grid-template-columns: 1fr 1fr; gap: 40px; }
  @media (max-width: 480px) { grid-template-columns: 1fr; }
`
export const FooterBrand = styled.div`
  img { height: 32px; margin-bottom: 20px; }
  p { font-size: 15px; color: ${({ theme }) => theme.colors.themeColors[200]}; line-height: 1.7; max-width: 320px; }
`
export const FooterCol = styled.div`
  h4 {
    font-size: 16px; font-weight: 700;
    margin-bottom: 24px; color: #fff;
  }
  a {
    display: block;
    color: ${({ theme }) => theme.colors.themeColors[200]};
    text-decoration: none;
    font-size: 15px; margin-bottom: 16px;
    transition: all 0.2s;
    &:hover { color: ${({ theme }) => theme.colors.primary[400]}; transform: translateX(4px); }
  }
`
export const FooterBottom = styled.div`
  max-width: 1200px; margin: 60px auto 0;
  padding-top: 32px;
  border-top: 1px solid rgba(255,255,255,0.05);
  display: flex; justify-content: space-between; align-items: center;
  flex-wrap: wrap; gap: 24px;
  p { color: ${({ theme }) => theme.colors.themeColors[300]}; font-size: 14px; }
`
export const SocialRow = styled.div`
  display: flex; gap: 12px;
  a {
    width: 44px; height: 44px;
    background: rgba(255,255,255,0.05);
    border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    color: ${({ theme }) => theme.colors.themeColors[200]};
    transition: all 0.3s;
    &:hover { background: ${({ theme }) => theme.colors.primary[600]}; color: #fff; transform: translateY(-3px); }
    svg { width: 20px; height: 20px; }
  }
`
