import React, { useState, ReactNode, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import styled from 'styled-components'

// ── Icons ──
export const InfoIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </svg>
)

// ── Types ──
interface TooltipProps {
  content: ReactNode
  children?: ReactNode
  position?: 'top' | 'bottom' | 'left' | 'right'
  iconOnly?: boolean
}

// ── Styled Components ──
const TriggerWrapper = styled.div`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: help;
  color: #8a8a8e;
  transition: color 0.2s ease;
  vertical-align: middle;
  margin-left: 4px;

  &:hover {
    color: #ad87ff;
  }
`

const TooltipContainer = styled.div<{
  $position: string
  $top: number
  $left: number
}>`
  position: fixed;
  top: ${({ $top }) => $top}px;
  left: ${({ $left }) => $left}px;
  background: #1a1a1a;
  border: 1px solid #2a2a2c;
  border-radius: 8px;
  padding: 10px 14px;
  color: #e0e0e0;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  max-width: 280px;
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(108, 56, 255, 0.1);
  z-index: 9999;
  pointer-events: none;
  animation: fadeIn 0.15s ease-out forwards;

  /* Triangle Arrow */
  &::after {
    content: '';
    position: absolute;
    width: 0;
    height: 0;
    border: 6px solid transparent;
  }

  /* Positioning Logic for Arrow */
  ${({ $position }) => {
    switch ($position) {
      case 'top':
        return `
          transform: translate(-50%, -100%);
          margin-top: -8px;
          &::after { top: 100%; left: 50%; transform: translateX(-50%); border-top-color: #2A2A2C; }
        `
      case 'bottom':
        return `
          transform: translate(-50%, 0);
          margin-top: 8px;
          &::after { bottom: 100%; left: 50%; transform: translateX(-50%); border-bottom-color: #2A2A2C; }
        `
      case 'left':
        return `
          transform: translate(-100%, -50%);
          margin-left: -8px;
          &::after { top: 50%; left: 100%; transform: translateY(-50%); border-left-color: #2A2A2C; }
        `
      case 'right':
        return `
          transform: translate(0, -50%);
          margin-left: 8px;
          &::after { top: 50%; right: 100%; transform: translateY(-50%); border-right-color: #2A2A2C; }
        `
      default:
        return ''
    }
  }}

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: ${({ $position }) => {
        switch ($position) {
          case 'top':
            return 'translate(-50%, calc(-100% + 4px))'
          case 'bottom':
            return 'translate(-50%, -4px)'
          case 'left':
            return 'translate(calc(-100% + 4px), -50%)'
          case 'right':
            return 'translate(-4px, -50%)'
          default:
            return 'none'
        }
      }};
    }
    to {
      opacity: 1;
      transform: ${({ $position }) => {
        switch ($position) {
          case 'top':
            return 'translate(-50%, -100%)'
          case 'bottom':
            return 'translate(-50%, 0)'
          case 'left':
            return 'translate(-100%, -50%)'
          case 'right':
            return 'translate(0, -50%)'
          default:
            return 'none'
        }
      }};
    }
  }
`

// ── Component ──
export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  position = 'top',
  iconOnly = false
}) => {
  const [isVisible, setIsVisible] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)

  const handleMouseEnter = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()

      let top = 0
      let left = 0

      switch (position) {
        case 'top':
          top = rect.top
          left = rect.left + rect.width / 2
          break
        case 'bottom':
          top = rect.bottom
          left = rect.left + rect.width / 2
          break
        case 'left':
          top = rect.top + rect.height / 2
          left = rect.left
          break
        case 'right':
          top = rect.top + rect.height / 2
          left = rect.right
          break
      }

      setCoords({ top, left })
      setIsVisible(true)
    }
  }

  const handleMouseLeave = () => {
    setIsVisible(false)
  }

  // Handle scroll and resize
  useEffect(() => {
    if (isVisible) {
      const handleScrollOrResize = () => setIsVisible(false)
      window.addEventListener('scroll', handleScrollOrResize, true)
      window.addEventListener('resize', handleScrollOrResize)
      return () => {
        window.removeEventListener('scroll', handleScrollOrResize, true)
        window.removeEventListener('resize', handleScrollOrResize)
      }
    }
  }, [isVisible])

  return (
    <>
      <TriggerWrapper
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {iconOnly ? <InfoIcon /> : children || <InfoIcon />}
      </TriggerWrapper>

      {isVisible &&
        typeof window !== 'undefined' &&
        createPortal(
          <TooltipContainer
            $position={position}
            $top={coords.top}
            $left={coords.left}
          >
            {content}
          </TooltipContainer>,
          document.body
        )}
    </>
  )
}

export default Tooltip
