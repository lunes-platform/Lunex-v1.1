/**
 * motion.ts — Global motion design system for Lunex DEX
 *
 * Provides reusable keyframes, CSS mixins, and styled-components
 * for micro-interactions, transitions, and animated feedback.
 *
 * All durations ≤300ms. GPU-accelerated where possible.
 * Respects prefers-reduced-motion via globals.ts.
 */
import styled, { keyframes, css } from 'styled-components'

// ─── Timing Tokens ───────────────────────────────────────────────
export const timing = {
    instant: '100ms',
    fast: '150ms',
    normal: '200ms',
    smooth: '300ms',
    slow: '500ms',
} as const

export const easing = {
    default: 'cubic-bezier(0.4, 0, 0.2, 1)',
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
    accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
} as const

// ─── Keyframes ───────────────────────────────────────────────────
export const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`

export const fadeInUp = keyframes`
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
`

export const fadeInDown = keyframes`
  from { opacity: 0; transform: translateY(-12px); }
  to { opacity: 1; transform: translateY(0); }
`

export const slideInRight = keyframes`
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: translateX(0); }
`

export const slideInLeft = keyframes`
  from { opacity: 0; transform: translateX(-20px); }
  to { opacity: 1; transform: translateX(0); }
`

export const scaleIn = keyframes`
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
`

export const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
`

export const shimmer = keyframes`
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
`

export const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`

export const rippleEffect = keyframes`
  0% { transform: scale(0); opacity: 0.5; }
  100% { transform: scale(4); opacity: 0; }
`

export const glowPulse = keyframes`
  0%, 100% { box-shadow: 0 0 0 0 rgba(108, 56, 255, 0); }
  50% { box-shadow: 0 0 20px 4px rgba(108, 56, 255, 0.15); }
`

export const countUp = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
`

export const checkmark = keyframes`
  0% { stroke-dashoffset: 24; }
  100% { stroke-dashoffset: 0; }
`

export const progressFill = keyframes`
  from { width: 0%; }
  to { width: 100%; }
`

// ─── CSS Mixins ──────────────────────────────────────────────────

/** Interactive button: hover scale + glow, press scale, GPU-accelerated */
export const interactiveButton = css`
  transition: all ${timing.fast} ${easing.default};
  will-change: transform, box-shadow;
  position: relative;
  overflow: hidden;

  &:hover:not(:disabled) {
    transform: translateY(-1px) scale(1.02);
    box-shadow: 0 4px 16px rgba(108, 56, 255, 0.2);
    filter: brightness(1.05);
  }

  &:active:not(:disabled) {
    transform: translateY(0) scale(0.98);
    box-shadow: 0 1px 4px rgba(108, 56, 255, 0.1);
    transition-duration: ${timing.instant};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    filter: none;
  }
`

/** Card hover: subtle lift + border glow */
export const interactiveCard = css`
  transition: all ${timing.normal} ${easing.default};
  will-change: transform, box-shadow, border-color;

  &:hover {
    transform: translateY(-3px);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(108, 56, 255, 0.1);
    border-color: #3A3A3C;
  }
`

/** Elevated card: stronger hover effect */
export const elevatedCard = css`
  ${interactiveCard}
  &:hover {
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4), 0 0 20px rgba(108, 56, 255, 0.08);
    border-color: rgba(108, 56, 255, 0.2);
  }
`

/** Smooth page entrance animation */
export const pageEntrance = css`
  animation: ${fadeInUp} ${timing.smooth} ${easing.decelerate} both;
`

/** Staggered children animation */
export const staggerChildren = (delayMs = 50) => css`
  & > * {
    animation: ${fadeInUp} ${timing.smooth} ${easing.decelerate} both;
  }
  ${Array.from({ length: 12 }, (_, i) => `
    & > *:nth-child(${i + 1}) {
      animation-delay: ${i * delayMs}ms;
    }
  `).join('')}
`

/** Shimmer loading placeholder */
export const shimmerLoading = css`
  background: linear-gradient(
    90deg,
    #232323 25%,
    #2A2A2C 50%,
    #232323 75%
  );
  background-size: 200% 100%;
  animation: ${shimmer} 1.5s ease-in-out infinite;
`

/** Number update flash */
export const numberUpdate = css`
  animation: ${countUp} ${timing.fast} ${easing.spring};
`

// ─── Styled Components ──────────────────────────────────────────

/** Skeleton loader with shimmer */
export const Skeleton = styled.div<{ width?: string; height?: string; radius?: string }>`
  width: ${({ width }) => width || '100%'};
  height: ${({ height }) => height || '16px'};
  border-radius: ${({ radius }) => radius || '6px'};
  ${shimmerLoading}
`

/** Animated spinner */
export const Spinner = styled.div<{ size?: number; color?: string }>`
  width: ${({ size }) => size || 20}px;
  height: ${({ size }) => size || 20}px;
  border: 2px solid ${({ color }) => color || '#2A2A2C'};
  border-top-color: ${({ color }) => color || '#6C38FF'};
  border-radius: 50%;
  animation: ${spin} 0.6s linear infinite;
`

/** Fade-in wrapper */
export const FadeIn = styled.div<{ delay?: number; duration?: string }>`
  animation: ${fadeIn} ${({ duration }) => duration || timing.smooth} ${easing.decelerate} both;
  animation-delay: ${({ delay }) => delay || 0}ms;
`

/** Scale-in wrapper for modals/popups */
export const ScaleIn = styled.div<{ delay?: number }>`
  animation: ${scaleIn} ${timing.normal} ${easing.spring} both;
  animation-delay: ${({ delay }) => delay || 0}ms;
`

/** Slide-in from right */
export const SlideInRight = styled.div<{ delay?: number }>`
  animation: ${slideInRight} ${timing.smooth} ${easing.decelerate} both;
  animation-delay: ${({ delay }) => delay || 0}ms;
`

/** Success checkmark SVG (animated) */
export const AnimatedCheckmark = styled.svg`
  width: 24px;
  height: 24px;

  circle {
    fill: #26D07C;
    opacity: 0;
    animation: ${fadeIn} ${timing.normal} ${easing.decelerate} 0.1s both;
  }

  path {
    stroke: #FFFFFF;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 24;
    stroke-dashoffset: 24;
    animation: ${checkmark} ${timing.smooth} ${easing.decelerate} 0.2s both;
    fill: none;
  }
`

/** Ripple effect for click feedback */
export const RippleContainer = styled.span`
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: inherit;
  pointer-events: none;

  &::after {
    content: '';
    position: absolute;
    width: 100%;
    height: 100%;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(0);
    background: radial-gradient(circle, rgba(255,255,255,0.2) 0%, transparent 70%);
    border-radius: 50%;
  }
`

/** Glow badge (e.g., "Top Trader", "Gold Tier") */
export const GlowBadge = styled.span<{ color?: string }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  background: ${({ color }) => color || '#6C38FF'}22;
  color: ${({ color }) => color || '#6C38FF'};
  animation: ${glowPulse} 2s ease-in-out infinite;
`

/** Page wrapper with entrance animation */
export const AnimatedPage = styled.div`
  ${pageEntrance}
  min-height: 100vh;
`

/** Grid with staggered children */
export const StaggeredGrid = styled.div`
  ${staggerChildren(60)}
`
