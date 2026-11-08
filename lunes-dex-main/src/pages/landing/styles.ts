import styled, { css, keyframes } from 'styled-components'
import { Link } from 'react-router-dom'

// ─── Tokens (landing palette, from the design handoff) ──────────────
export const SPACE = '#07070A'
const EASE = 'cubic-bezier(0, 0, 0.2, 1)'
const PAD_X = 'clamp(16px, 5vw, 72px)'

const grotesk = css`
  font-family: 'Space Grotesk', 'Inter', sans-serif;
`

// ─── Keyframes ──────────────────────────────────────────────────────
export const orbit = keyframes`to { transform: rotate(360deg) }`
export const orbitRev = keyframes`to { transform: rotate(-360deg) }`
const floatY = keyframes`
  0%, 100% { transform: translateY(0) }
  50% { transform: translateY(-14px) }
`
const dash = keyframes`to { stroke-dashoffset: -40 }`
const marquee = keyframes`to { transform: translateX(-50%) }`
const ring = keyframes`
  0% { transform: scale(0.6); opacity: 0.7 }
  100% { transform: scale(1.9); opacity: 0 }
`
const glow = keyframes`
  0%, 100% { opacity: 0.55 }
  50% { opacity: 1 }
`
const rise = keyframes`
  from { opacity: 0; transform: translateY(22px) }
  to { opacity: 1; transform: none }
`
const sweep = keyframes`
  from { transform: translateX(-120%) skewX(-20deg) }
  to { transform: translateX(320%) skewX(-20deg) }
`

// ─── Root ───────────────────────────────────────────────────────────
/** overflow-x: clip (not hidden) so the sticky diagram keeps working. */
export const Root = styled.div`
  position: relative;
  min-height: 100vh;
  background: ${SPACE};
  color: #ffffff;
  font-family: 'Inter', sans-serif;
  overflow-x: clip;
  -webkit-font-smoothing: antialiased;

  a {
    text-decoration: none;
  }

  /* Scroll reveal (driven by data-rv set from the motion hook). */
  [data-reveal][data-rv='pending'] {
    opacity: 0;
    transform: translateY(32px);
  }
  [data-reveal][data-rv='in'] {
    transition:
      opacity 0.8s ${EASE},
      transform 0.8s ${EASE},
      border-color 0.25s,
      box-shadow 0.25s;
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
`

const Arrow = css`
  svg {
    flex-shrink: 0;
  }
`

// ─── Nav ────────────────────────────────────────────────────────────
export const Nav = styled.nav`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 50;
  height: 68px;
  display: flex;
  align-items: center;
  gap: 28px;
  padding: 0 clamp(16px, 4vw, 48px);
  border-bottom: 1px solid transparent;
  transition:
    background-color 0.3s ease,
    border-color 0.3s ease,
    backdrop-filter 0.3s ease;

  &[data-scrolled='true'] {
    background: rgba(7, 7, 10, 0.72);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-bottom-color: rgba(255, 255, 255, 0.06);
  }
`

export const LogoLink = styled(Link)`
  display: flex;
  align-items: center;
  img {
    height: 22px;
    display: block;
  }
`

export const NavLinks = styled.div`
  display: flex;
  gap: 4px;
  margin-left: 12px;
`

export const NavLink = styled.button`
  ${grotesk};
  height: 36px;
  padding: 0 14px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #b6b6b6;
  font-weight: 500;
  font-size: 14px;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
  &:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.05);
  }
`

export const NavCta = styled(Link)`
  ${grotesk};
  ${Arrow};
  margin-left: auto;
  height: 42px;
  padding: 0 20px;
  border-radius: 12px;
  background: #6c38ff;
  color: #ffffff;
  font-weight: 600;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 0 0 0 rgba(108, 56, 255, 0.5);
  transition:
    box-shadow 0.25s,
    background-color 0.15s;
  &:hover {
    background: #5228db;
    color: #ffffff;
    box-shadow: 0 0 28px rgba(108, 56, 255, 0.55);
  }
`

// ─── Shared section bits ────────────────────────────────────────────
export const Section = styled.section<{ $pad?: string }>`
  position: relative;
  z-index: 1;
  padding: ${p => p.$pad || `100px ${PAD_X}`};
`

export const Inner = styled.div`
  position: relative;
  max-width: 1240px;
  margin: 0 auto;
`

export const SectionHead = styled.div<{ $mb?: number }>`
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 720px;
  margin-bottom: ${p => (p.$mb ? `${p.$mb}px` : 0)};
`

export const Kicker = styled.span`
  ${grotesk};
  font-size: 14px;
  font-weight: 600;
  color: #ad87ff;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`

export const H2 = styled.h2`
  ${grotesk};
  margin: 0;
  font-size: clamp(34px, 4.6vw, 60px);
  font-weight: 700;
  line-height: 1.02;
  letter-spacing: -0.03em;
  text-wrap: balance;
`

export const Lead = styled.p`
  margin: 0;
  font-size: 17px;
  line-height: 1.65;
  color: #b6b6b6;
  max-width: 520px;
`

// ─── Hero ───────────────────────────────────────────────────────────
export const Hero = styled.section`
  position: relative;
  z-index: 1;
  min-height: 100vh;
  display: flex;
  align-items: center;
  padding: 110px ${PAD_X} 120px;
`

export const Nebula = styled.div<{ $variant: 'violet' | 'green' }>`
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  ${p =>
    p.$variant === 'violet'
      ? css`
          top: -10%;
          left: -15%;
          width: 70vw;
          height: 70vw;
          max-width: 900px;
          max-height: 900px;
          background: radial-gradient(
            circle,
            rgba(108, 56, 255, 0.28) 0%,
            rgba(108, 56, 255, 0.08) 40%,
            transparent 70%
          );
        `
      : css`
          bottom: -20%;
          right: -10%;
          width: 55vw;
          height: 55vw;
          max-width: 760px;
          max-height: 760px;
          background: radial-gradient(
            circle,
            rgba(38, 208, 124, 0.14) 0%,
            transparent 65%
          );
        `}
`

export const HeroInner = styled(Inner)`
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 40px;
`

export const HeroCopy = styled.div`
  flex: 1.15 1 400px;
  display: flex;
  flex-direction: column;
  gap: 26px;
  min-width: 0;
`

export const H1 = styled.h1`
  ${grotesk};
  margin: 0;
  font-weight: 700;
  font-size: clamp(44px, 7.2vw, 96px);
  line-height: 0.98;
  letter-spacing: -0.035em;
  text-wrap: balance;
  animation: ${rise} 0.9s ${EASE} 0.1s both;
`

export const Gradient = styled.span`
  background: linear-gradient(100deg, #ad87ff 0%, #6c38ff 45%, #26d07c 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
`

export const HeroLead = styled.p`
  margin: 0;
  max-width: 560px;
  font-size: clamp(16px, 1.5vw, 19px);
  line-height: 1.6;
  color: #b6b6b6;
  text-wrap: pretty;
  animation: ${rise} 0.9s ${EASE} 0.2s both;
`

export const Ctas = styled.div`
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  animation: ${rise} 0.9s ${EASE} 0.3s both;
`

export const PrimaryCta = styled(Link)`
  ${grotesk};
  ${Arrow};
  position: relative;
  overflow: hidden;
  height: 56px;
  padding: 0 28px;
  border-radius: 16px;
  background: #6c38ff;
  color: #ffffff;
  font-weight: 600;
  font-size: 17px;
  display: flex;
  align-items: center;
  gap: 10px;
  box-shadow: 0 10px 40px rgba(108, 56, 255, 0.45);
  transition:
    transform 0.2s,
    box-shadow 0.25s;
  &:hover {
    color: #ffffff;
    transform: translateY(-2px);
    box-shadow: 0 16px 56px rgba(108, 56, 255, 0.65);
  }
`

export const Sweep = styled.span`
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 40%;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.25),
    transparent
  );
  animation: ${sweep} 3.2s ease-in-out 1.2s infinite;
  pointer-events: none;
`

export const GhostCta = styled.button`
  ${grotesk};
  ${Arrow};
  height: 56px;
  padding: 0 26px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.03);
  color: #ffffff;
  font-weight: 600;
  font-size: 17px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
  &:hover {
    border-color: #6c38ff;
    background: rgba(108, 56, 255, 0.1);
  }
`

export const HeroArt = styled.div`
  flex: 1 1 340px;
  display: flex;
  justify-content: center;
  min-width: 0;
`

export const OrbitStage = styled.div`
  position: relative;
  width: min(540px, 82vw, 100%);
  aspect-ratio: 1;
  transition: transform 0.4s ${EASE};
`

export const RingLine = styled.div<{ $inset: string; $border: string }>`
  position: absolute;
  inset: ${p => p.$inset};
  border-radius: 50%;
  border: ${p => p.$border};
`

/** A rotating ring; its child sits on the top edge. */
export const OrbitTrack = styled.div<{
  $inset: string
  $dur: string
  $delay: string
}>`
  position: absolute;
  inset: ${p => p.$inset};
  animation: ${orbit} ${p => p.$dur} linear infinite;
  animation-delay: ${p => p.$delay};
`

export const OrbitAnchor = styled.div`
  position: absolute;
  top: 0;
  left: 50%;
  transform: translate(-50%, -50%);
`

/** Counter-rotates at the same speed so the token stays upright. */
export const OrbitBody = styled.div<{
  $dur: string
  $delay: string
  $size: string
  $glow?: string
  $border?: string
}>`
  width: ${p => p.$size};
  height: ${p => p.$size};
  border-radius: 50%;
  background: #16151c;
  border: 1px solid ${p => p.$border || 'rgba(255, 255, 255, 0.12)'};
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: ${p => (p.$glow ? `0 0 24px ${p.$glow}` : 'none')};
  animation: ${orbitRev} ${p => p.$dur} linear infinite;
  animation-delay: ${p => p.$delay};
  img {
    width: 70%;
    height: 70%;
    border-radius: 50%;
  }
`

export const Core = styled.div`
  position: absolute;
  inset: 38%;
  display: flex;
  align-items: center;
  justify-content: center;
`

export const Pulse = styled.span<{ $delay?: string }>`
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid rgba(108, 56, 255, 0.6);
  animation: ${ring} 3s ease-out ${p => p.$delay || '0s'} infinite;
`

export const Planet = styled.div`
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: radial-gradient(
    circle at 35% 30%,
    #9469ff 0%,
    #6c38ff 45%,
    #291193 100%
  );
  box-shadow:
    0 0 80px rgba(108, 56, 255, 0.7),
    inset -12px -16px 40px rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: ${floatY} 6s ease-in-out infinite;
  img {
    width: 46%;
    height: 46%;
    filter: drop-shadow(0 0 12px rgba(255, 255, 255, 0.4));
  }
`

export const Marquee = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 56px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(7, 7, 10, 0.6);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  overflow: hidden;
  display: flex;
  align-items: center;
`

export const MarqueeTrack = styled.div`
  display: flex;
  gap: 48px;
  white-space: nowrap;
  animation: ${marquee} 38s linear infinite;
  padding-left: 48px;
`

export const Tick = styled.span`
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  img {
    width: 20px;
    height: 20px;
    border-radius: 50%;
  }
`

export const TickPair = styled.span`
  ${grotesk};
  font-weight: 600;
`

// ─── Stats ──────────────────────────────────────────────────────────
export const StatsBand = styled.div`
  max-width: 1240px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 24px;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.03),
    rgba(255, 255, 255, 0.01)
  );
  overflow: hidden;
`

export const StatCell = styled.div`
  padding: 28px 28px 30px;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  gap: 8px;
`

export const StatLabel = styled.span`
  font-size: 13px;
  color: #8a8a8e;
`

export const StatValue = styled.span`
  ${grotesk};
  font-size: clamp(32px, 3.6vw, 46px);
  font-weight: 600;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
`

// ─── How it works ───────────────────────────────────────────────────
export const HowLayout = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 32px;
  align-items: flex-start;
`

export const DiagramSticky = styled.div<{ $wide: boolean }>`
  flex: 1 1 340px;
  position: sticky;
  top: ${p => (p.$wide ? '110px' : '72px')};
  z-index: 2;
  min-width: 0;
  display: flex;
  justify-content: center;
  ${p =>
    !p.$wide &&
    css`
      /* Mobile: steps scroll under the diagram, so mask them out. */
      padding-bottom: 16px;
      background: linear-gradient(${SPACE} 88%, transparent);
    `}
`

export const DiagramCard = styled.div<{ $wide: boolean }>`
  position: relative;
  width: 100%;
  max-width: ${p =>
    p.$wide ? 'min(560px, calc(100vh - 150px))' : 'min(380px, 44vh)'};
  border-radius: 28px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: radial-gradient(
    circle at 50% 40%,
    rgba(108, 56, 255, 0.16),
    rgba(10, 10, 14, 0.92) 70%
  );
  padding: 12px;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
  svg {
    width: 100%;
    height: auto;
    display: block;
  }
`

export const Flow = styled.path`
  animation: ${dash} 1s linear infinite;
  transition: opacity 0.5s ease;
`

export const Node = styled.g`
  transition: opacity 0.4s;
`

export const Dots = styled.div`
  position: absolute;
  left: 20px;
  right: 20px;
  bottom: 18px;
  display: flex;
  gap: 6px;
`

export const Dot = styled.button<{ $on: boolean }>`
  flex: 1;
  height: 4px;
  border: none;
  padding: 0;
  border-radius: 999px;
  background: ${p => (p.$on ? '#6C38FF' : 'rgba(255,255,255,0.1)')};
  cursor: pointer;
  transition: background-color 0.4s;
`

export const StepsCol = styled.div`
  flex: 1 1 300px;
  display: flex;
  flex-direction: column;
  min-width: 0;
`

export const Step = styled.div<{ $on: boolean; $wide: boolean }>`
  min-height: ${p => (p.$wide ? '62vh' : '46vh')};
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 14px;
  padding: 24px 0;
  opacity: ${p => (p.$on ? 1 : 0.32)};
  transform: translateX(${p => (p.$on ? '0px' : '-8px')});
  transition:
    opacity 0.45s ease,
    transform 0.45s ${EASE};
`

export const StepHead = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
`

export const StepBadge = styled.span<{ $on: boolean }>`
  ${grotesk};
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: ${p => (p.$on ? '#6C38FF' : 'rgba(255,255,255,0.04)')};
  border: 1px solid ${p => (p.$on ? '#6C38FF' : 'rgba(255,255,255,0.12)')};
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 18px;
  transition:
    background-color 0.4s,
    border-color 0.4s;
`

export const StepKicker = styled.span`
  ${grotesk};
  font-size: 13px;
  font-weight: 600;
  color: #ad87ff;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`

export const StepTitle = styled.h3`
  ${grotesk};
  margin: 0;
  font-size: clamp(26px, 3vw, 38px);
  font-weight: 600;
  letter-spacing: -0.02em;
`

export const StepBody = styled.p`
  margin: 0;
  font-size: 17px;
  line-height: 1.65;
  color: #b6b6b6;
  max-width: 480px;
  text-wrap: pretty;
`

// ─── Benefits ───────────────────────────────────────────────────────
export const BenefitPlanet = styled.div`
  position: absolute;
  top: 10%;
  right: -12%;
  width: 520px;
  height: 520px;
  border-radius: 50%;
  background: radial-gradient(
    circle at 35% 30%,
    rgba(148, 105, 255, 0.5),
    rgba(41, 17, 147, 0.35) 55%,
    transparent 72%
  );
  filter: blur(2px);
  pointer-events: none;
`

export const Stack = styled(Inner)`
  display: flex;
  flex-direction: column;
  gap: 40px;
`

export const CardGrid = styled.div<{ $min: number }>`
  display: grid;
  grid-template-columns: repeat(
    auto-fit,
    minmax(min(${p => p.$min}px, 100%), 1fr)
  );
  gap: 16px;
`

export const BenefitCard = styled.div`
  position: relative;
  overflow: hidden;
  padding: 28px;
  border-radius: 22px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.035),
    rgba(255, 255, 255, 0.01)
  );
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 240px;
  transition:
    border-color 0.25s,
    transform 0.25s,
    box-shadow 0.25s;
  &:hover {
    border-color: rgba(108, 56, 255, 0.6);
    transform: translateY(-6px);
    box-shadow: 0 24px 60px rgba(108, 56, 255, 0.2);
  }
  > *:not(:first-child) {
    position: relative;
  }
`

export const CardGlow = styled.div<{ $color: string; $delay: number }>`
  position: absolute;
  top: -60px;
  right: -60px;
  width: 180px;
  height: 180px;
  border-radius: 50%;
  background: radial-gradient(circle, ${p => p.$color}, transparent 70%);
  animation: ${glow} 4s ease-in-out infinite;
  animation-delay: ${p => p.$delay}ms;
  pointer-events: none;
`

export const BenefitIcon = styled.div<{ $color: string }>`
  width: 52px;
  height: 52px;
  border-radius: 16px;
  background: rgba(108, 56, 255, 0.14);
  border: 1px solid rgba(108, 56, 255, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${p => p.$color};
`

export const BigRow = styled.div`
  display: flex;
  align-items: baseline;
  gap: 10px;
`

export const Big = styled.span<{ $color: string }>`
  ${grotesk};
  font-size: 34px;
  font-weight: 700;
  color: ${p => p.$color};
  letter-spacing: -0.02em;
`

export const BigSub = styled.span`
  font-size: 13px;
  color: #8a8a8e;
`

export const CardTitle = styled.h3`
  ${grotesk};
  margin: 0;
  font-size: 21px;
  font-weight: 600;
`

export const CardBody = styled.p`
  margin: 0;
  font-size: 15px;
  line-height: 1.6;
  color: #b6b6b6;
`

// ─── Modes ──────────────────────────────────────────────────────────
export const ModeCard = styled(Link)<{ $color: string }>`
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 26px;
  border-radius: 22px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: #0e0d13;
  color: #ffffff;
  min-height: 300px;
  height: 100%;
  transition:
    border-color 0.25s,
    transform 0.25s;
  &:hover {
    border-color: ${p => p.$color};
    transform: translateY(-4px);
    color: #ffffff;
  }
`

export const ModeArt = styled.div`
  height: 110px;
  position: relative;
  margin-bottom: 6px;
`

export const ModeRing = styled.div<{ $ring: string }>`
  position: absolute;
  left: 0;
  top: 10px;
  width: 90px;
  height: 90px;
  border-radius: 50%;
  border: 1px dashed ${p => p.$ring};
  animation: ${orbit} 14s linear infinite;
`

export const ModeMoon = styled.span<{ $color: string }>`
  position: absolute;
  top: -5px;
  left: 40px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: ${p => p.$color};
  box-shadow: 0 0 12px ${p => p.$color};
`

export const ModeIcon = styled.div<{
  $color: string
  $tint: string
  $ring: string
}>`
  position: absolute;
  left: 22px;
  top: 32px;
  width: 46px;
  height: 46px;
  border-radius: 14px;
  background: ${p => p.$tint};
  border: 1px solid ${p => p.$ring};
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${p => p.$color};
`

export const ModeKicker = styled.span<{ $color: string }>`
  ${grotesk};
  font-size: 13px;
  font-weight: 600;
  color: ${p => p.$color};
  letter-spacing: 0.06em;
  text-transform: uppercase;
`

export const ModeTitle = styled.span`
  ${grotesk};
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.01em;
`

export const ModeBody = styled.span`
  font-size: 15px;
  line-height: 1.6;
  color: #b6b6b6;
  flex: 1;
`

export const ModeOpen = styled.span`
  ${grotesk};
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
`

// ─── Ecosystem ──────────────────────────────────────────────────────
export const EcoLayout = styled(Inner)`
  display: flex;
  flex-wrap: wrap;
  gap: 56px;
  align-items: center;
`

export const EcoCopy = styled.div`
  flex: 1 1 380px;
  display: flex;
  flex-direction: column;
  gap: 22px;
  min-width: 0;
`

export const TokenList = styled.div`
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  overflow: hidden;
  background: rgba(14, 13, 19, 0.8);
`

export const TokenRow = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  & + & {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }
  img {
    width: 32px;
    height: 32px;
    border-radius: 50%;
  }
`

export const TokenName = styled.span`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  b {
    ${grotesk};
    font-weight: 600;
  }
  small {
    font-size: 12px;
    color: #8a8a8e;
  }
`

export const TokenPrice = styled.span`
  font-variant-numeric: tabular-nums;
  font-weight: 500;
`

export const TokenChg = styled.span<{ $color: string }>`
  min-width: 64px;
  text-align: right;
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: ${p => p.$color};
`

export const EcoArt = styled.div`
  flex: 1 1 420px;
  display: flex;
  justify-content: center;
  min-width: 0;
`

export const EcoStage = styled.div`
  position: relative;
  width: min(500px, 86vw);
  aspect-ratio: 1;
`

export const EcoPlanet = styled.div`
  position: absolute;
  inset: 18%;
  border-radius: 50%;
  background: radial-gradient(
    circle at 32% 28%,
    #ad87ff 0%,
    #6c38ff 35%,
    #291193 75%,
    #120640 100%
  );
  box-shadow:
    0 0 120px rgba(108, 56, 255, 0.55),
    inset -30px -40px 80px rgba(0, 0, 0, 0.55);
`

export const EcoBands = styled.div`
  position: absolute;
  inset: 18%;
  border-radius: 50%;
  background: repeating-linear-gradient(
    -20deg,
    rgba(255, 255, 255, 0.05) 0 10px,
    transparent 10px 26px
  );
  mix-blend-mode: overlay;
`

export const EcoRing = styled.div`
  position: absolute;
  left: -4%;
  right: -4%;
  top: 44%;
  height: 12%;
  border-radius: 50%;
  border: 2px solid rgba(202, 175, 255, 0.35);
  transform: rotate(-14deg);
  box-shadow: 0 0 30px rgba(173, 135, 255, 0.25);
`

// ─── CTA + footer ───────────────────────────────────────────────────
export const CtaSection = styled.section`
  position: relative;
  z-index: 1;
  padding: 120px ${PAD_X} 0;
  overflow: hidden;
`

export const CtaInner = styled.div`
  position: relative;
  z-index: 2;
  max-width: 860px;
  margin: 0 auto;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
  padding-bottom: 200px;
`

export const CtaTitle = styled.h2`
  ${grotesk};
  margin: 0;
  font-size: clamp(40px, 6vw, 80px);
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.035em;
`

export const CtaLead = styled.p`
  margin: 0;
  font-size: 18px;
  line-height: 1.6;
  color: #b6b6b6;
  max-width: 560px;
`

export const CtaButton = styled(Link)`
  ${grotesk};
  ${Arrow};
  height: 60px;
  padding: 0 34px;
  border-radius: 18px;
  background: #6c38ff;
  color: #ffffff;
  font-weight: 600;
  font-size: 18px;
  display: flex;
  align-items: center;
  gap: 10px;
  box-shadow: 0 14px 60px rgba(108, 56, 255, 0.55);
  transition:
    transform 0.2s,
    box-shadow 0.25s;
  &:hover {
    color: #ffffff;
    transform: translateY(-3px) scale(1.02);
    box-shadow: 0 20px 80px rgba(108, 56, 255, 0.75);
  }
`

/** Planet horizon; parallax keeps the translateX(-50%) (data-center). */
export const Horizon = styled.div`
  position: absolute;
  left: 50%;
  bottom: -130vw;
  width: 160vw;
  height: 160vw;
  max-width: 2400px;
  max-height: 2400px;
  transform: translateX(-50%);
  border-radius: 50%;
  background: radial-gradient(
    circle at 50% 0%,
    #3c1cb7 0%,
    #1b0a7a 18%,
    #0b0420 40%,
    #07070a 60%
  );
  box-shadow: 0 -20px 120px rgba(108, 56, 255, 0.45);
  border-top: 2px solid rgba(173, 135, 255, 0.55);
  pointer-events: none;
`

export const Footer = styled.footer`
  position: relative;
  z-index: 2;
  padding: 32px ${PAD_X} 40px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: ${SPACE};
`

export const FooterInner = styled(Inner)`
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  justify-content: space-between;
  align-items: center;
`

export const FooterBrand = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  img {
    height: 18px;
  }
  span {
    font-size: 13px;
    color: #8a8a8e;
  }
`

export const FooterLinks = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 22px;
  font-size: 14px;
  a {
    color: #ad87ff;
    transition: color 0.15s ease;
  }
  a:hover {
    color: #caafff;
  }
`
