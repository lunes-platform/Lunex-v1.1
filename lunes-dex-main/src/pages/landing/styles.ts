import styled, { keyframes } from 'styled-components'

// ============================================================
// DESIGN TOKENS
// ============================================================
const PURPLE = '#6C38FF' // ← brand primary: CTAs, accents, active states
const MINT = '#00E5A0' // ← hero gradient title ONLY
const GOLD = '#FFD700' // ← leaderboard rank #1
const BG = '#080808'
const SURFACE = '#111111'
const SURFACE2 = '#181818'
const BORDER = 'rgba(255,255,255,0.07)'
const BORDER_HOVER = 'rgba(255,255,255,0.14)'
const TEXT = '#F8F8F8'
const MUTED = 'rgba(248,248,248,0.45)'

// ============================================================
// ANIMATIONS
// ============================================================
export const fadeInUp = keyframes`
  from { opacity: 0; transform: translateY(28px); }
  to   { opacity: 1; transform: translateY(0); }
`
export const fadeIn = keyframes`
  from { opacity: 0; }
  to   { opacity: 1; }
`
export const floatY = keyframes`
  0%, 100% { transform: translateY(0) rotate(var(--r,0deg)); }
  50%       { transform: translateY(-10px) rotate(var(--r,0deg)); }
`
export const orbitSpin = keyframes`
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
`
export const counterSpin = keyframes`
  from { transform: rotate(0deg); }
  to   { transform: rotate(-360deg); }
`
export const shimmer = keyframes`
  0%   { background-position: -200% 0; }
  100% { background-position:  200% 0; }
`
export const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
`
export const flowPulse = keyframes`
  0%   { opacity: 0.3; transform: scaleX(0.8); }
  50%  { opacity: 1;   transform: scaleX(1); }
  100% { opacity: 0.3; transform: scaleX(0.8); }
`
export const terminalType = keyframes`
  from { opacity: 0; transform: translateX(-6px); }
  to   { opacity: 1; transform: translateX(0); }
`
export const gradientShift = keyframes`
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
`

interface Anim {
  $delay?: string
}

// ============================================================
// LAYOUT
// ============================================================
export const Page = styled.div`
  min-height: 100vh;
  background: ${BG};
  color: ${TEXT};
  overflow-x: hidden;
  position: relative;
  font-family: 'Space Grotesk', sans-serif;

  /* Subtle dot grid texture */
  &::after {
    content: '';
    position: fixed;
    inset: 0;
    background: url("data:image/svg+xml,%3Csvg width='24' height='24' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='1' cy='1' r='0.5' fill='%23ffffff' opacity='0.025'/%3E%3C/svg%3E")
      repeat;
    pointer-events: none;
    z-index: 0;
  }
`

// ============================================================
// NAV
// ============================================================
export const Nav = styled.nav<{ $scrolled?: boolean }>`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  padding: 0 20px;
  height: 64px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: ${p => (p.$scrolled ? 'rgba(8,8,8,0.88)' : 'transparent')};
  backdrop-filter: ${p => (p.$scrolled ? 'blur(20px)' : 'none')};
  -webkit-backdrop-filter: ${p => (p.$scrolled ? 'blur(20px)' : 'none')};
  border-bottom: 1px solid ${p => (p.$scrolled ? BORDER : 'transparent')};
  transition: all 0.3s ease;
  @media (max-width: 768px) {
    padding: 0 12px;
  }
`
export const Logo = styled.div`
  display: flex;
  align-items: center;
  img {
    height: 28px;
    width: auto;
  }
`
export const NavLinks = styled.div`
  display: flex;
  align-items: center;
  gap: 28px;
  @media (max-width: 900px) {
    display: none;
  }
`
export const NavLink = styled.a`
  color: ${MUTED};
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.02em;
  transition: color 0.2s;
  &:hover {
    color: ${TEXT};
  }
`
export const ConnectBtn = styled.button`
  background: ${PURPLE};
  color: #fff;
  border: none;
  padding: 8px 20px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.2s;
  &:hover {
    background: #7d4dff;
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(108, 56, 255, 0.4);
  }
  &:active {
    transform: translateY(0) scale(0.96);
  }
`

// ============================================================
// HERO
// ============================================================
export const HeroSection = styled.section`
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 120px 40px 80px;
  position: relative;
  z-index: 2;
  text-align: center;

  .desktop-br {
    display: block;
  }
  @media (max-width: 768px) {
    padding: 100px 20px 60px;
    .desktop-br {
      display: none;
    }
  }

  /* Subtle top glow */
  &::before {
    content: '';
    position: absolute;
    top: -15%;
    left: 50%;
    transform: translateX(-50%);
    width: 70vw;
    height: 60vh;
    background: radial-gradient(
      ellipse at center,
      rgba(255, 255, 255, 0.025) 0%,
      transparent 65%
    );
    pointer-events: none;
    z-index: -1;
  }
`
export const HeroBadge = styled.div<Anim>`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  border: 1px solid ${BORDER_HOVER};
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  color: ${MUTED};
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 32px;
  opacity: 0;
  animation: ${fadeInUp} 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  animation-delay: ${p => p.$delay || '0s'};
  background: rgba(255, 255, 255, 0.03);
`
export const HeroTitle = styled.h1<Anim>`
  font-size: clamp(64px, 10vw, 128px);
  font-weight: 800;
  line-height: 0.95;
  letter-spacing: -0.04em;
  margin-bottom: 32px;
  font-family: 'Space Grotesk', sans-serif;
  opacity: 0;
  animation: ${fadeInUp} 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  animation-delay: ${p => p.$delay || '0.1s'};

  span {
    background: linear-gradient(135deg, ${MINT} 0%, #00ffb4 50%, ${MINT} 100%);
    background-size: 200% 200%;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: ${gradientShift} 6s ease infinite;
  }
`
export const HeroSub = styled.p<Anim>`
  font-size: clamp(16px, 2vw, 20px);
  color: ${MUTED};
  max-width: 600px;
  line-height: 1.65;
  margin-bottom: 40px;
  opacity: 0;
  animation: ${fadeInUp} 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  animation-delay: ${p => p.$delay || '0.2s'};
`
export const HeroBtns = styled.div<Anim>`
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  justify-content: center;
  margin-bottom: 80px;
  opacity: 0;
  animation: ${fadeInUp} 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  animation-delay: ${p => p.$delay || '0.3s'};
`

// Hero Token Orbit
export const HeroOrbit = styled.div<Anim>`
  position: relative;
  width: 680px;
  height: 680px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: -160px;
  opacity: 0;
  animation: ${fadeIn} 1s ease forwards;
  animation-delay: ${p => p.$delay || '0.5s'};

  @media (max-width: 768px) {
    width: 480px;
    height: 480px;
    margin-bottom: -100px;
  }
`
export const dynamicCounterSpin = keyframes`
  from { transform: rotate(var(--start-angle)); }
  to   { transform: rotate(var(--end-angle)); }
`
export const floatBob = keyframes`
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-8px); }
`

export const OrbitCenter = styled.div`
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: rgba(108, 56, 255, 0.1);
  border: 2px solid rgba(108, 56, 255, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  box-shadow: 0 0 30px rgba(108, 56, 255, 0.2);

  img {
    width: 48px;
    height: 48px;
    border-radius: 50%;
  }
`

export const OrbitRing = styled.div<{ $radius: number; $duration: number }>`
  position: absolute;
  width: ${p => p.$radius * 2}px;
  height: ${p => p.$radius * 2}px;
  border-radius: 50%;
  border: 1px dashed rgba(255, 255, 255, 0.06);
  animation: ${orbitSpin} ${p => p.$duration}s linear infinite;
  top: 50%;
  left: 50%;
  margin-top: -${p => p.$radius}px;
  margin-left: -${p => p.$radius}px;
`

export const OrbitTokenWrapper = styled.div<{
  $angle: number
  $radius: number
}>`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: rotate(${p => p.$angle}deg) translateX(${p => p.$radius}px);
  width: 0;
  height: 0;
`

export const OrbitTokenInner = styled.div<{
  $duration: number
  $angle: number
}>`
  position: absolute;
  width: 56px;
  height: 56px;
  margin-top: -28px;
  margin-left: -28px;
  border-radius: 50%;
  background: ${SURFACE2};
  border: 1px solid ${BORDER};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  color: ${TEXT};
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  --start-angle: -${p => p.$angle}deg;
  --end-angle: calc(-${p => p.$angle}deg - 360deg);
  animation: ${dynamicCounterSpin} ${p => p.$duration}s linear infinite;
`

export const OrbitTokenFloat = styled.div<{ $delay: number }>`
  animation: ${floatBob} 4s ease-in-out infinite;
  animation-delay: ${p => p.$delay}s;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;

  img {
    width: 32px;
    height: 32px;
    border-radius: 50%;
  }
`

// Hero swap card
export const HeroSwapCard = styled.div<Anim>`
  background: rgba(17, 17, 17, 0.9);
  border: 1px solid ${BORDER};
  border-radius: 16px;
  padding: 24px;
  width: 100%;
  max-width: 380px;
  position: relative;
  z-index: 3;
  opacity: 0;
  animation: ${fadeInUp} 0.8s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  animation-delay: ${p => p.$delay || '0.55s'};
  box-shadow: 0 40px 80px rgba(0, 0, 0, 0.5);
  margin-top: -20px;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 24px;
    right: 24px;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(255, 255, 255, 0.15),
      transparent
    );
    opacity: 1;
  }

  @media (max-width: 768px) {
    max-width: 100%;
  }
`

// ============================================================
// SHARED BUTTONS
// ============================================================
export const PrimaryBtn = styled.button`
  background: ${PURPLE};
  color: #fff;
  border: none;
  padding: 14px 32px;
  border-radius: 6px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  transition:
    transform 0.2s,
    box-shadow 0.2s;
  position: relative;
  overflow: hidden;
  letter-spacing: 0.02em;

  &::after {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(255, 255, 255, 0.18),
      transparent
    );
    animation: ${shimmer} 2.5s infinite;
  }

  &:hover {
    background: #7d4dff;
    transform: translateY(-3px);
    box-shadow: 0 12px 30px rgba(108, 56, 255, 0.45);
    filter: none;
  }
  &:active {
    transform: translateY(0) scale(0.97);
  }
  svg {
    width: 18px;
    height: 18px;
  }
`
export const SecBtn = styled.button`
  background: rgba(255, 255, 255, 0.04);
  color: ${TEXT};
  border: 1px solid ${BORDER_HOVER};
  padding: 14px 32px;
  border-radius: 6px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  transition: all 0.2s;
  &:hover {
    border-color: rgba(255, 255, 255, 0.25);
    background: rgba(255, 255, 255, 0.07);
    transform: translateY(-3px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
    filter: none;
  }
  &:active {
    transform: translateY(0) scale(0.97);
  }
  svg {
    width: 16px;
    height: 16px;
    opacity: 0.7;
  }
`

// ============================================================
// SWAP PREVIEW ELEMENTS (reused from old design)
// ============================================================
export const SwapHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  h3 {
    font-size: 15px;
    font-weight: 600;
  }
  span {
    font-size: 11px;
    color: ${MUTED};
  }
`
export const SwapTopStats = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-bottom: 14px;
`
export const SwapTopStat = styled.div`
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid ${BORDER};
  strong {
    display: block;
    font-size: 13px;
    font-weight: 700;
    color: ${TEXT};
    margin-bottom: 2px;
  }
  span {
    font-size: 10px;
    color: ${MUTED};
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
`
export const SwapField = styled.div<{ $active?: boolean }>`
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid ${p => (p.$active ? BORDER_HOVER : BORDER)};
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
`
export const SwapFieldLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  img {
    width: 26px;
    height: 26px;
    border-radius: 50%;
  }
  span {
    font-weight: 600;
    font-size: 14px;
  }
`
export const SwapFieldRight = styled.div`
  text-align: right;
  .amount {
    font-size: 20px;
    font-weight: 700;
  }
  .usd {
    font-size: 11px;
    color: ${MUTED};
    margin-top: 2px;
  }
`
export const SwapArrow = styled.div`
  display: flex;
  justify-content: center;
  margin: -4px 0;
  position: relative;
  z-index: 2;
  div {
    width: 32px;
    height: 32px;
    background: ${SURFACE2};
    border: 1px solid ${BORDER};
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.5);
    svg {
      width: 14px;
      height: 14px;
    }
  }
`
export const SwapButton = styled.div`
  background: ${PURPLE};
  color: #fff;
  border: none;
  padding: 13px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 800;
  text-align: center;
  margin-top: 12px;
  cursor: pointer;
  transition: all 0.2s;
  letter-spacing: 0.02em;
  &:hover {
    background: #7d4dff;
    transform: translateY(-2px);
    box-shadow: 0 10px 24px rgba(108, 56, 255, 0.35);
  }
`
export const SwapInfo = styled.div`
  display: flex;
  justify-content: space-between;
  margin-top: 10px;
  font-size: 11px;
  color: ${MUTED};
`

// ============================================================
// STATS BAR
// ============================================================
export const StatsBar = styled.section<Anim>`
  padding: 40px;
  opacity: 0;
  &.in-view {
    animation: ${fadeIn} 0.8s ease forwards;
    animation-delay: ${p => p.$delay || '0s'};
  }
  position: relative;
  z-index: 2;
  border-top: 1px solid ${BORDER};
  border-bottom: 1px solid ${BORDER};
  background: ${SURFACE};
  @media (max-width: 768px) {
    padding: 32px 16px;
  }
`
export const StatsGrid = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0;
  @media (max-width: 900px) {
    grid-template-columns: repeat(3, 1fr);
  }
  @media (max-width: 560px) {
    grid-template-columns: repeat(2, 1fr);
  }
`
export const StatItem = styled.div`
  text-align: center;
  padding: 16px 20px;
  position: relative;

  & + & {
    border-left: 1px solid ${BORDER};
    @media (max-width: 560px) {
      &:nth-child(2n + 1) {
        border-left: none;
      }
    }
  }
`
export const StatVal = styled.div`
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: ${TEXT};
`
export const StatLabel = styled.div`
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: ${MUTED};
  margin-top: 4px;
`

// ============================================================
// SECTION HELPERS
// ============================================================
export const Section = styled.section`
  padding: 120px 40px;
  max-width: 1200px;
  margin: 0 auto;
  position: relative;
  z-index: 2;
  @media (max-width: 768px) {
    padding: 80px 16px;
  }
`
export const DarkSection = styled.section`
  padding: 120px 40px;
  background: ${SURFACE};
  border-top: 1px solid ${BORDER};
  border-bottom: 1px solid ${BORDER};
  position: relative;
  z-index: 2;

  > * {
    max-width: 1200px;
    margin-left: auto;
    margin-right: auto;
  }

  @media (max-width: 768px) {
    padding: 80px 16px;
  }
`
export const SectionLabel = styled.div`
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: ${PURPLE};
  text-align: center;
  margin-bottom: 16px;
  opacity: 0;
  &.in-view {
    animation: ${fadeInUp} 0.5s ease forwards;
  }
`
export const STitle = styled.h2`
  font-size: clamp(28px, 4.5vw, 52px);
  font-weight: 800;
  text-align: center;
  margin-bottom: 16px;
  letter-spacing: -0.03em;
  font-family: 'Space Grotesk', sans-serif;
  opacity: 0;
  &.in-view {
    animation: ${fadeInUp} 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    animation-delay: 0.05s;
  }
  /* one accent word per title */
  span {
    color: ${PURPLE};
  }
`
export const SSub = styled.p`
  font-size: 17px;
  color: ${MUTED};
  text-align: center;
  max-width: 540px;
  margin: 0 auto 64px;
  line-height: 1.65;
  opacity: 0;
  &.in-view {
    animation: ${fadeInUp} 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    animation-delay: 0.1s;
  }
`

// ============================================================
// HOW LUNEX WORKS — FLOW DIAGRAM
// ============================================================
export const FlowSection = styled.section`
  padding: 120px 40px;
  max-width: 1200px;
  margin: 0 auto;
  position: relative;
  z-index: 2;
  @media (max-width: 768px) {
    padding: 80px 16px;
  }
`
export const flowDashAnim = keyframes`
  to { stroke-dashoffset: -40; }
`
export const flowDashAnimReverse = keyframes`
  to { stroke-dashoffset: 40; }
`
export const corePulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(108,56,255,0.4); }
  70% { box-shadow: 0 0 0 20px rgba(108,56,255,0); }
  100% { box-shadow: 0 0 0 0 rgba(108,56,255,0); }
`

export const FlowDiagram = styled.div`
  position: relative;
  width: 100%;
  max-width: 900px;
  height: 500px;
  margin: 40px auto 0;
  opacity: 0;
  &.in-view {
    animation: ${fadeInUp} 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    animation-delay: 0.15s;
  }
  @media (max-width: 768px) {
    height: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 32px;
  }
`

export const FlowSVG = styled.svg`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  pointer-events: none;

  .flow-line {
    fill: none;
    stroke: rgba(108, 56, 255, 0.2);
    stroke-width: 2;
  }

  .flow-anim {
    fill: none;
    stroke: rgba(108, 56, 255, 0.8);
    stroke-width: 2;
    stroke-dasharray: 8 12;
    animation: ${flowDashAnim} 1s linear infinite;
  }
  .flow-anim-out {
    fill: none;
    stroke: rgba(108, 56, 255, 0.8);
    stroke-width: 2;
    stroke-dasharray: 8 12;
    animation: ${flowDashAnimReverse} 1s linear infinite;
  }

  @media (max-width: 768px) {
    display: none;
  }
`

export const FlowCore = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 160px;
  height: 160px;
  background: ${SURFACE};
  border: 2px solid #6c38ff;
  border-radius: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  z-index: 2;
  box-shadow: 0 0 30px rgba(108, 56, 255, 0.3);
  animation: ${corePulse} 2s infinite;

  svg {
    color: #fff;
    width: 32px;
    height: 32px;
  }
  span {
    font-size: 16px;
    font-weight: 700;
    color: #fff;
  }

  @media (max-width: 768px) {
    position: relative;
    top: auto;
    left: auto;
    transform: none;
  }
`

export const FlowNodeGroup = styled.div<{ $side: 'left' | 'right' }>`
  position: absolute;
  top: 50%;
  ${p => (p.$side === 'left' ? 'left: 0;' : 'right: 0;')}
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 16px;
  z-index: 2;

  @media (max-width: 768px) {
    position: relative;
    top: auto;
    left: auto;
    right: auto;
    transform: none;
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
  }
`

export const FlowNode = styled.div<{ $accent: string }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  background: ${SURFACE2};
  border: 1px solid ${BORDER};
  border-radius: 12px;
  width: 220px;
  transition: all 0.3s ease;

  &:hover {
    border-color: ${p => p.$accent};
    box-shadow: 0 4px 16px ${p => p.$accent}20;
    transform: translateX(4px);
  }

  svg {
    color: ${p => p.$accent};
    width: 20px;
    height: 20px;
    flex-shrink: 0;
  }

  .content {
    display: flex;
    flex-direction: column;
    span {
      font-size: 14px;
      font-weight: 600;
      color: ${TEXT};
    }
    small {
      font-size: 11px;
      color: rgba(255, 255, 255, 0.5);
    }
  }

  @media (max-width: 768px) {
    width: 160px;
    padding: 10px 16px;
    .content small {
      display: none;
    }
    &:hover {
      transform: translateY(-2px);
    }
  }
`

export const FlowMobileArrow = styled.div`
  display: none;
  @media (max-width: 768px) {
    display: block;
    width: 2px;
    height: 30px;
    background: linear-gradient(
      180deg,
      rgba(108, 56, 255, 1),
      rgba(108, 56, 255, 0.2)
    );
  }
`

// ============================================================
// ASYMMETRIC LIQUIDITY — REDESIGN COMPLETO
// ============================================================
export const AsymSection = styled.section`
  padding: 0;
  background:
    radial-gradient(
      ellipse 800px 400px at 50% 80%,
      rgba(0, 229, 160, 0.04) 0%,
      transparent 70%
    ),
    linear-gradient(180deg, ${BG} 0%, #030a06 40%, #030a06 60%, ${BG} 100%);
  position: relative;
  z-index: 2;
  overflow: hidden;
  border-top: 1px solid rgba(0, 229, 160, 0.12);

  /* Faixa neon horizontal no topo */
  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 400px;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent,
      #00e5a0 40%,
      #00e5a0 60%,
      transparent
    );
    opacity: 0.5;
    z-index: 3;
  }
  @media (max-width: 768px) {
    padding: 0;
  }
`

export const AsymHeader = styled.div`
  text-align: center;
  padding: 90px 40px 50px;
  max-width: 860px;
  margin: 0 auto;
  position: relative;
  z-index: 2;
  @media (max-width: 768px) {
    padding: 60px 20px 40px;
  }
`

export const AsymTitle = styled.h2`
  font-family: 'Space Grotesk', sans-serif;
  font-size: clamp(32px, 5vw, 60px);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.1;
  color: #ffffff;
  margin-bottom: 20px;
  span {
    color: #00e5a0;
    text-shadow: 0 0 40px rgba(0, 229, 160, 0.4);
  }
`

export const AsymSubtitle = styled.p`
  font-size: clamp(15px, 1.8vw, 18px);
  color: rgba(255, 255, 255, 0.5);
  max-width: 600px;
  margin: 0 auto;
  line-height: 1.7;
`

export const AsymStat = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 14px;
  background: rgba(0, 229, 160, 0.07);
  border: 1px solid rgba(0, 229, 160, 0.2);
  border-radius: 100px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 2.5px;
  color: #00e5a0;
  margin-bottom: 24px;
`

export const AsymGrid = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 40px 100px;
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: 60px;
  align-items: start;
  @media (max-width: 960px) {
    grid-template-columns: 1fr;
    gap: 40px;
    padding: 0 20px 80px;
  }
`
export const AsymContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding-top: 20px;
`
export const AsymFeatureList = styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
`
export const AsymFeature = styled.div<Anim & { $accent: string }>`
  padding: 20px 24px;
  background: rgba(255, 255, 255, 0.02);
  border-left: 3px solid ${p => p.$accent};
  position: relative;
  overflow: hidden;
  transition:
    transform 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275),
    background 0.35s ease,
    box-shadow 0.35s ease;
  cursor: default;
  will-change: transform;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, ${p => p.$accent}12 0%, transparent 60%);
    opacity: 0;
    transition: opacity 0.35s ease;
    z-index: 0;
  }

  h4 {
    position: relative;
    z-index: 1;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 17px;
    font-weight: 700;
    color: #fff;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  p {
    position: relative;
    z-index: 1;
    font-size: 13.5px;
    line-height: 1.65;
    color: rgba(255, 255, 255, 0.55);
  }

  &:hover {
    transform: translateX(8px);
    background: rgba(255, 255, 255, 0.03);
    box-shadow: -8px 0 28px ${p => p.$accent}18;
    &::before {
      opacity: 1;
    }
  }
`

/* === CHART ÁREA — totalmente nova === */
const curveReveal = keyframes`
  from { stroke-dashoffset: 1200; }
  to   { stroke-dashoffset: 0; }
`
const curveRevealBase = keyframes`
  from { stroke-dashoffset: 1400; }
  to   { stroke-dashoffset: 0; }
`
const priceDotPulse = keyframes`
  0%, 100% { r: 6px; opacity: 1; }
  50%       { r: 9px; opacity: 0.7; }
`
const scanLine = keyframes`
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(120%); }
`
const aiZoneGlow = keyframes`
  0%, 100% { fill: rgba(0, 229, 160, 0.04); }
  50%       { fill: rgba(0, 229, 160, 0.10); }
`
const labelFloat = keyframes`
  0%, 100% { transform: translateY(0); }
  50%       { transform: translateY(-3px); }
`

export const AsymChartWrap = styled.div<Anim>`
  position: relative;
  width: 100%;
  height: 440px;
  background: #050c09;
  border: 1px solid rgba(0, 229, 160, 0.12);
  border-radius: 4px;
  overflow: hidden;
  box-shadow:
    0 0 0 1px rgba(0, 229, 160, 0.05),
    0 40px 80px rgba(0, 0, 0, 0.6),
    inset 0 0 120px rgba(0, 0, 0, 0.5);

  /* HUD scan line */
  &::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 60%;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(0, 229, 160, 0.4),
      transparent
    );
    animation: ${scanLine} 4s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    pointer-events: none;
  }

  @media (max-width: 768px) {
    height: 320px;
  }
`

export const ChartLabels = styled.div`
  position: absolute;
  top: 20px;
  right: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 10;
`
export const ChartLabel = styled.div<{ $color: string }>`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: rgba(255, 255, 255, 0.8);
  animation: ${labelFloat} 3s ease-in-out infinite;
  &::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${p => p.$color};
    box-shadow: 0 0 8px ${p => p.$color};
  }
`
export const ChartMetrics = styled.div`
  position: absolute;
  bottom: 20px;
  left: 20px;
  display: grid;
  grid-template-columns: repeat(3, auto);
  gap: 24px;
  z-index: 10;
`
export const ChartMetric = styled.div<{ $color: string }>`
  .val {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 22px;
    font-weight: 800;
    color: ${p => p.$color};
    line-height: 1;
    text-shadow: 0 0 20px ${p => p.$color}60;
  }
  .lbl {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: rgba(255, 255, 255, 0.4);
    margin-top: 2px;
  }
`

export const AsymSVG = styled.svg`
  width: 100%;
  height: 100%;

  .grid {
    stroke: rgba(0, 229, 160, 0.04);
    stroke-width: 1;
  }
  .axis-x {
    stroke: rgba(255, 255, 255, 0.08);
    stroke-width: 1;
  }
  .axis-y {
    stroke: rgba(255, 255, 255, 0.08);
    stroke-width: 1;
  }
  .tick {
    stroke: rgba(255, 255, 255, 0.06);
    stroke-width: 1;
  }

  /* Curva base (xy) - pontilhada e fraca */
  .base-curve {
    fill: none;
    stroke: rgba(255, 255, 255, 0.12);
    stroke-width: 1.5;
    stroke-dasharray: 6 4;
    stroke-dashoffset: 1400;
    animation: ${curveRevealBase} 2s ease-out 0.3s forwards;
  }

  /* Curva concentrada VERDE — o destaque */
  .active-curve {
    fill: none;
    stroke: #00e5a0;
    stroke-width: 2.5;
    stroke-dasharray: 1200;
    stroke-dashoffset: 1200;
    animation: ${curveReveal} 1.8s cubic-bezier(0.16, 1, 0.3, 1) 0.6s forwards;
    filter: drop-shadow(0 0 6px rgba(0, 229, 160, 0.5));
  }

  /* Zona AI */
  .ai-zone {
    animation: ${aiZoneGlow} 3s ease-in-out infinite;
    stroke: rgba(0, 229, 160, 0.2);
    stroke-width: 1;
    stroke-dasharray: 5 3;
  }

  /* Fill gradiente */
  .fill-area {
    opacity: 0.12;
  }

  /* Dot de preço */
  .price-dot {
    fill: #00e5a0;
    filter: drop-shadow(0 0 8px rgba(0, 229, 160, 0.9));
    animation: ${priceDotPulse} 2s ease-in-out infinite;
  }

  /* Labels dentro do SVG */
  .svg-label {
    font-size: 10px;
    fill: rgba(255, 255, 255, 0.4);
    font-family: 'Space Grotesk', sans-serif;
    letter-spacing: 0.5px;
  }
  .svg-label-green {
    font-size: 11px;
    fill: #00e5a0;
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 700;
  }
`
export const ModesSection = styled.section`
  padding: 120px 40px;
  background: ${SURFACE};
  border-top: 1px solid ${BORDER};
  position: relative;
  z-index: 2;
  @media (max-width: 768px) {
    padding: 80px 16px;
  }
`
export const ModesGrid = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  @media (max-width: 1024px) {
    grid-template-columns: repeat(2, 1fr);
  }
  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`
export const ModeCard = styled.div<Anim & { $accent: string }>`
  background: ${BG};
  border: 1px solid ${BORDER};
  border-radius: 12px;
  padding: 32px 24px;
  cursor: pointer;
  opacity: 0;
  &.in-view {
    animation: ${fadeInUp} 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    animation-delay: ${p => p.$delay || '0s'};
  }
  transition: all 0.3s cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: ${p => p.$accent};
    opacity: 0.5;
    transition: opacity 0.3s;
  }

  &:hover {
    transform: translateY(-8px);
    border-color: ${p => p.$accent}30;
    box-shadow:
      0 24px 48px rgba(0, 0, 0, 0.4),
      0 0 0 1px ${p => p.$accent}10 inset;
    &::before {
      opacity: 1;
    }
  }
`
export const ModeTag = styled.div`
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: ${MUTED};
  margin-bottom: 16px;
`
export const ModeIcon = styled.div<{ $accent: string }>`
  width: 56px;
  height: 56px;
  border-radius: 10px;
  background: ${p => p.$accent}15;
  border: 1px solid ${p => p.$accent}25;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
  color: ${p => p.$accent};
  svg {
    width: 28px;
    height: 28px;
  }
  transition: all 0.3s;

  ${ModeCard}:hover & {
    transform: scale(1.1);
    background: ${p => p.$accent}25;
  }
`
export const ModeTitle = styled.h3`
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 12px;
  letter-spacing: -0.01em;
  font-family: 'Space Grotesk', sans-serif;
`
export const ModeDesc = styled.p`
  font-size: 14px;
  color: ${MUTED};
  line-height: 1.65;
  margin-bottom: 24px;
`
export const ModeStats = styled.div`
  display: flex;
  gap: 12px;
  flex-wrap: wrap;

  span {
    font-size: 11px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid ${BORDER};
    color: ${MUTED};
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
`

// ============================================================
// AI AGENTS / OPENCLAW
// ============================================================
export const AgentSection = styled.section`
  padding: 120px 40px;
  position: relative;
  z-index: 2;
  @media (max-width: 768px) {
    padding: 80px 16px;
  }
`
export const AgentInner = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 80px;
  align-items: center;
  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    gap: 48px;
  }
`
export const AgentLeft = styled.div``
export const AgentRight = styled.div<Anim>`
  opacity: 0;
  &.in-view {
    animation: ${fadeInUp} 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    animation-delay: 0.2s;
  }
`
export const AgentSteps = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
  opacity: 0;
  &.in-view {
    animation: ${fadeInUp} 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    animation-delay: 0.15s;
  }
`
export const AgentStep = styled.div`
  display: flex;
  gap: 20px;
  align-items: flex-start;
`
export const AgentStepNum = styled.div`
  font-size: 12px;
  font-weight: 800;
  color: ${PURPLE};
  letter-spacing: 0.06em;
  min-width: 28px;
  padding-top: 2px;
`
export const AgentStepBody = styled.div`
  h4 {
    font-size: 16px;
    font-weight: 700;
    margin-bottom: 6px;
    color: ${TEXT};
  }
  p {
    font-size: 14px;
    color: ${MUTED};
    line-height: 1.6;
  }
`

// Terminal
export const AgentTerminal = styled.div`
  background: #0a0a0a;
  border: 1px solid ${BORDER};
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 40px 80px rgba(0, 0, 0, 0.6);
`
export const TerminalBar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: #111;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    &.red {
      background: #ff5f57;
    }
    &.yellow {
      background: #febc2e;
    }
    &.green {
      background: #28c840;
    }
  }

  .title {
    font-size: 11px;
    color: ${MUTED};
    margin-left: 8px;
    font-family: 'Space Grotesk', monospace;
  }
`
export const TerminalBody = styled.div`
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 260px;
`
export const TerminalLine = styled.div<{ $color: string; $delay?: string }>`
  font-family: 'Space Grotesk', monospace;
  font-size: 13px;
  color: ${p => p.$color};
  opacity: 0;
  animation: ${terminalType} 0.4s ease forwards;
  animation-delay: ${p => p.$delay || '0s'};
  line-height: 1.5;
`
export const TerminalCursor = styled.div`
  width: 8px;
  height: 16px;
  background: rgba(255, 255, 255, 0.6);
  opacity: 0;
  animation: ${pulse} 1s step-end infinite;
  animation-delay: 1.8s;
`

// ============================================================
// COPYTRADE LEADERBOARD
// ============================================================
export const LeaderGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`
export const LeaderCard = styled.div<Anim & { $rank: number }>`
  background: ${SURFACE};
  border: 1px solid ${BORDER};
  border-radius: 12px;
  padding: 28px 24px;
  position: relative;
  opacity: 0;
  &.in-view {
    animation: ${fadeInUp} 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    animation-delay: ${p => p.$delay || '0s'};
  }
  transition: all 0.3s;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: ${p =>
      p.$rank === 1
        ? GOLD
        : p.$rank === 2
          ? 'rgba(192,192,192,0.8)'
          : 'rgba(205,127,50,0.8)'};
  }

  &:hover {
    transform: translateY(-6px);
    border-color: ${BORDER_HOVER};
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
  }
`
export const LeaderRank = styled.div`
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: ${MUTED};
  text-transform: uppercase;
  margin-bottom: 16px;
`
export const LeaderInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
`
export const LeaderAvatar = styled.div`
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid ${BORDER_HOVER};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 800;
  color: ${TEXT};
  flex-shrink: 0;
`
export const LeaderName = styled.div`
  font-size: 15px;
  font-weight: 700;
  color: ${TEXT};
`
export const LeaderMeta = styled.div`
  font-size: 11px;
  color: ${MUTED};
  margin-top: 2px;
`
export const LeaderStats = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 20px;
  padding: 16px;
  background: ${BG};
  border-radius: 8px;
  border: 1px solid ${BORDER};
`
export const LeaderStat = styled.div`
  text-align: center;
`
export const StatNum = styled.div<{ $positive?: boolean }>`
  font-size: 16px;
  font-weight: 800;
  color: ${TEXT};
  letter-spacing: -0.01em;
`
export const StatLbl = styled.div`
  font-size: 10px;
  color: ${MUTED};
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: 2px;
`
export const LeaderBtn = styled.button`
  width: 100%;
  padding: 10px;
  border-radius: 6px;
  border: 1px solid rgba(108, 56, 255, 0.35);
  background: rgba(108, 56, 255, 0.08);
  color: ${PURPLE};
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.2s;
  letter-spacing: 0.02em;
  &:hover {
    background: rgba(108, 56, 255, 0.15);
    border-color: rgba(108, 56, 255, 0.6);
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(108, 56, 255, 0.15);
    filter: none;
  }
`

// ============================================================
// STRATEGY MARKETPLACE
// ============================================================
export const StratGrid = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`
export const StratCard = styled.div<Anim & { $featured?: boolean }>`
  background: ${BG};
  border: 1px solid ${p => (p.$featured ? BORDER_HOVER : BORDER)};
  border-radius: 12px;
  padding: 28px 24px;
  position: relative;
  opacity: 0;
  &.in-view {
    animation: ${fadeInUp} 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    animation-delay: ${p => p.$delay || '0s'};
  }
  transition: all 0.3s;
  &:hover {
    transform: translateY(-6px);
    border-color: ${BORDER_HOVER};
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
  }
`
export const StratFeaturedBadge = styled.div`
  position: absolute;
  top: -12px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid ${BORDER_HOVER};
  color: ${TEXT};
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 4px 14px;
  border-radius: 20px;
  white-space: nowrap;
`
export const StratHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
`
export const StratBadge = styled.div<{ $color: string }>`
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 4px 10px;
  border-radius: 4px;
  background: ${p => p.$color}18;
  border: 1px solid ${p => p.$color}30;
  color: ${p => p.$color};
`
export const StratRating = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 700;
  color: ${GOLD};
  svg {
    width: 12px;
    height: 12px;
    fill: ${GOLD};
  }
`
export const StratName = styled.h3`
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 10px;
  letter-spacing: -0.01em;
`
export const StratDesc = styled.p`
  font-size: 13px;
  color: ${MUTED};
  line-height: 1.65;
  margin-bottom: 20px;
`
export const StratMetrics = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 20px;
  padding: 14px;
  background: ${SURFACE};
  border-radius: 8px;
  border: 1px solid ${BORDER};

  .val {
    display: block;
    font-size: 15px;
    font-weight: 800;
    color: ${TEXT};
    text-align: center;
  }
  .lbl {
    display: block;
    font-size: 10px;
    color: ${MUTED};
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-top: 2px;
  }
`
export const StratMetric = styled.div``
export const StratBtn = styled.button`
  width: 100%;
  padding: 11px;
  border-radius: 6px;
  border: none;
  background: ${PURPLE};
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.2s;
  letter-spacing: 0.02em;
  &:hover {
    background: #7d4dff;
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(108, 56, 255, 0.35);
    filter: none;
  }
`

// ============================================================
// ECOSYSTEM GRID
// ============================================================
export const EcoGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  @media (max-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
  }
  @media (max-width: 480px) {
    grid-template-columns: 1fr;
  }
`
export const EcoCard = styled.div<Anim & { $accent: string }>`
  background: ${SURFACE};
  border: 1px solid ${BORDER};
  border-radius: 10px;
  padding: 24px 20px;
  cursor: pointer;
  opacity: 0;
  &.in-view {
    animation: ${fadeInUp} 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    animation-delay: ${p => p.$delay || '0s'};
  }
  transition: all 0.3s;

  &:hover {
    transform: translateY(-4px);
    border-color: ${p => p.$accent}30;
    box-shadow: 0 16px 32px rgba(0, 0, 0, 0.25);
  }

  h4 {
    font-size: 15px;
    font-weight: 700;
    margin: 12px 0 6px;
    color: ${TEXT};
  }
  p {
    font-size: 13px;
    color: ${MUTED};
    line-height: 1.55;
  }
`
export const EcoIcon = styled.div<{ $accent: string }>`
  width: 48px;
  height: 48px;
  border-radius: 10px;
  background: ${p => p.$accent}12;
  border: 1px solid ${p => p.$accent}20;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${p => p.$accent};
  transition: all 0.3s;

  ${EcoCard}:hover & {
    transform: scale(1.1);
    background: ${p => p.$accent}22;
  }
`

// ============================================================
// ONBOARDING STEPS
// ============================================================
export const StepsWrap = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
  position: relative;
  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
`
export const Step = styled.div<Anim>`
  opacity: 0;
  &.in-view {
    animation: ${fadeInUp} 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    animation-delay: ${p => p.$delay || '0s'};
  }
  position: relative;
`
export const StepNum = styled.div`
  font-size: 48px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.07);
  letter-spacing: -0.03em;
  line-height: 1;
  margin-bottom: 16px;
`
export const StepConnector = styled.div<{ $last?: boolean }>`
  display: none; /* removed linear connector — grid handles layout */
`
export const StepBody = styled.div`
  background: ${SURFACE};
  border: 1px solid ${BORDER};
  border-radius: 12px;
  padding: 28px 24px;
  transition: all 0.3s;

  &:hover {
    border-color: ${BORDER_HOVER};
    transform: translateY(-4px);
    box-shadow: 0 16px 32px rgba(0, 0, 0, 0.25);
  }

  h3 {
    font-size: 18px;
    font-weight: 700;
    margin-bottom: 10px;
    color: ${TEXT};
  }
  p {
    font-size: 14px;
    color: ${MUTED};
    line-height: 1.65;
  }
`
export const StepIcon = styled.div`
  width: 48px;
  height: 48px;
  border-radius: 10px;
  background: rgba(108, 56, 255, 0.1);
  border: 1px solid rgba(108, 56, 255, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${PURPLE};
  margin-bottom: 16px;
`

// ============================================================
// CTA
// ============================================================
export const CTASection = styled.section`
  padding: 120px 40px;
  position: relative;
  z-index: 2;
  @media (max-width: 768px) {
    padding: 80px 16px;
  }
`
export const CTACard = styled.div`
  max-width: 720px;
  margin: 0 auto;
  text-align: center;
  background: ${SURFACE};
  border: 1px solid ${BORDER};
  border-radius: 20px;
  padding: 72px 48px;
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 60%;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(108, 56, 255, 0.5),
      transparent
    );
    opacity: 1;
  }
  &::after {
    content: '';
    position: absolute;
    top: -60%;
    left: 50%;
    transform: translateX(-50%);
    width: 60%;
    height: 100%;
    background: radial-gradient(
      ellipse,
      rgba(108, 56, 255, 0.06) 0%,
      transparent 70%
    );
    pointer-events: none;
  }

  @media (max-width: 600px) {
    padding: 48px 24px;
  }
`
export const CTATitle = styled.h2`
  font-size: clamp(28px, 4vw, 48px);
  font-weight: 800;
  font-family: 'Space Grotesk', sans-serif;
  letter-spacing: -0.03em;
  margin-bottom: 20px;
  line-height: 1.1;
`
export const CTADesc = styled.p`
  font-size: 17px;
  color: ${MUTED};
  max-width: 440px;
  margin: 0 auto 36px;
  line-height: 1.65;
`
export const CTABtns = styled.div`
  display: flex;
  gap: 16px;
  justify-content: center;
  flex-wrap: wrap;
`

// ============================================================
// FOOTER
// ============================================================
export const Footer = styled.footer`
  background: ${SURFACE};
  border-top: 1px solid ${BORDER};
  padding: 72px 40px 32px;
  position: relative;
  z-index: 2;
  @media (max-width: 768px) {
    padding: 48px 16px 24px;
  }
`
export const FooterGrid = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr 1fr;
  gap: 48px;
  margin-bottom: 48px;
  @media (max-width: 900px) {
    grid-template-columns: 1fr 1fr;
    gap: 32px;
  }
  @media (max-width: 480px) {
    grid-template-columns: 1fr;
  }
`
export const FooterBrand = styled.div`
  p {
    font-size: 14px;
    color: ${MUTED};
    line-height: 1.6;
    margin-top: 16px;
    max-width: 240px;
  }
`
export const FooterCol = styled.div`
  h4 {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: ${TEXT};
    margin-bottom: 16px;
  }
  a {
    display: block;
    font-size: 14px;
    color: ${MUTED};
    text-decoration: none;
    margin-bottom: 10px;
    transition: color 0.2s;
    &:hover {
      color: ${PURPLE};
    }
  }
`
export const FooterBottom = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 24px;
  border-top: 1px solid ${BORDER};
  p {
    font-size: 13px;
    color: ${MUTED};
  }
  @media (max-width: 600px) {
    flex-direction: column;
    gap: 16px;
    text-align: center;
  }
`
export const SocialRow = styled.div`
  display: flex;
  gap: 16px;
  a {
    color: ${MUTED};
    transition: color 0.2s;
    &:hover {
      color: ${PURPLE};
    }
    svg {
      width: 18px;
      height: 18px;
    }
  }
`
