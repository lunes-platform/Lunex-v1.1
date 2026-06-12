/**
 * motion.ts — Global motion design system for Lunex DEX
 *
 * Provides reusable keyframes, CSS mixins, and styled-components
 * for micro-interactions, transitions, and animated feedback.
 *
 * All durations ≤300ms. GPU-accelerated where possible.
 * Respects prefers-reduced-motion via globals.ts.
 */
import { keyframes, css } from 'styled-components'

// ─── Timing Tokens ───────────────────────────────────────────────
export const timing = {
  instant: '100ms',
  fast: '150ms',
  normal: '200ms',
  smooth: '300ms',
  slow: '500ms'
} as const

export const easing = {
  default: 'cubic-bezier(0.4, 0, 0.2, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
  accelerate: 'cubic-bezier(0.4, 0, 1, 1)'
} as const

// ─── Keyframes ───────────────────────────────────────────────────
export const fadeInUp = keyframes`
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
`

export const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
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
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.3),
      0 0 0 1px rgba(108, 56, 255, 0.1);
    border-color: #3a3a3c;
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
  ${Array.from(
    { length: 12 },
    (_, i) => `
    & > *:nth-child(${i + 1}) {
      animation-delay: ${i * delayMs}ms;
    }
  `
  ).join('')}
`
