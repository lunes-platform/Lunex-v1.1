/**
 * Dialog — accessible modal / mobile bottom sheet.
 *
 * - role=dialog + aria-modal; focus moves inside on open (first text input,
 *   else the dialog); Tab is trapped; Esc closes the top-most dialog only;
 *   focus returns to the trigger on close.
 * - Desktop: centered, radius 20, fade + translateY 10 + scale .97 (200ms),
 *   backdrop blur 4px.
 * - Mobile (<760): bottom sheet, radius 24 24 0 0, slides up 300ms, drag
 *   handle (drag > 90px closes), safe-area bottom padding, no blur.
 */
import React, { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import styled, { css } from 'styled-components'
import { X } from 'lucide-react'
import { fadeIn, modalEnter, sheetEnter } from '../../styles/motion'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { C, EASE_OUT, grotesk } from './kit'

const stack: symbol[] = []

const Backdrop = styled.div<{ $mobile: boolean; $z: number }>`
  position: fixed;
  inset: 0;
  z-index: ${p => p.$z};
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: ${p => (p.$mobile ? 'flex-end' : 'center')};
  padding: ${p => (p.$mobile ? '0' : '16px')};
  animation: ${fadeIn} 200ms ${EASE_OUT};
  ${p =>
    !p.$mobile &&
    css`
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    `}
`

const Box = styled.div<{ $mobile: boolean; $width: number; $pad: number }>`
  position: relative;
  width: 100%;
  max-width: ${p => (p.$mobile ? 'none' : `${p.$width}px`)};
  max-height: ${p => (p.$mobile ? '92vh' : '100%')};
  overflow-y: auto;
  background: ${C.surface};
  border: 1px solid ${C.border};
  border-radius: ${p => (p.$mobile ? '24px 24px 0 0' : '20px')};
  padding: ${p => p.$pad}px;
  padding-bottom: ${p =>
    p.$mobile ? `calc(20px + env(safe-area-inset-bottom))` : '24px'};
  display: flex;
  flex-direction: column;
  gap: 18px;
  box-shadow: 0 32px 80px rgba(0, 0, 0, 0.6);
  animation: ${p =>
    p.$mobile
      ? css`
          ${sheetEnter} 300ms ${EASE_OUT}
        `
      : css`
          ${modalEnter} 200ms ${EASE_OUT}
        `};
`

const Handle = styled.div`
  align-self: center;
  width: 44px;
  height: 5px;
  border-radius: 999px;
  background: ${C.borderStrong};
  margin: -10px 0 2px;
  flex-shrink: 0;
  cursor: grab;
  touch-action: none;
`

const Head = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  h2 {
    ${grotesk};
    font-size: 20px;
    font-weight: 600;
  }
  p {
    margin-top: 4px;
    font-size: 13px;
    color: ${C.muted};
    line-height: 1.5;
  }
`

export const CloseButton = styled.button`
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 8px;
  border: 1px solid ${C.borderStrong};
  background: transparent;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  &:hover {
    border-color: ${C.primary};
  }
`

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export type DialogProps = {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  description?: React.ReactNode
  ariaLabel?: string
  width?: number
  padding?: number
  zIndex?: number
  /** Disable backdrop click / Esc / drag dismiss (e.g. while signing). */
  locked?: boolean
  hideClose?: boolean
  children?: React.ReactNode
  role?: 'dialog' | 'alertdialog'
}

export const Dialog: React.FC<DialogProps> = ({
  open,
  onClose,
  title,
  description,
  ariaLabel,
  width = 440,
  padding = 24,
  zIndex = 60,
  locked,
  hideClose,
  children,
  role = 'dialog'
}) => {
  const mobile = useIsMobile()
  const boxRef = useRef<HTMLDivElement>(null)
  const idRef = useRef(Symbol('dialog'))
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const lockedRef = useRef(locked)
  lockedRef.current = locked

  useLayoutEffect(() => {
    if (!open) return
    const id = idRef.current
    const trigger = document.activeElement as HTMLElement | null
    stack.push(id)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    requestAnimationFrame(() => {
      const box = boxRef.current
      if (!box) return
      const target =
        box.querySelector<HTMLElement>(
          'input:not([type=range]):not([type=checkbox]),textarea'
        ) || box
      try {
        target.focus({ preventScroll: true })
      } catch {
        /* noop */
      }
    })

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return
      if (e.key === 'Escape') {
        if (!lockedRef.current) {
          e.stopPropagation()
          closeRef.current()
        }
        return
      }
      if (e.key === 'Tab' && boxRef.current) {
        const els = Array.from(
          boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
        ).filter(el => el.offsetParent !== null)
        if (!els.length) {
          e.preventDefault()
          return
        }
        const first = els[0]
        const last = els[els.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || active === boxRef.current)) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)

    return () => {
      window.removeEventListener('keydown', onKey)
      const i = stack.indexOf(id)
      if (i >= 0) stack.splice(i, 1)
      if (!stack.length) document.body.style.overflow = prevOverflow
      if (trigger && document.contains(trigger)) {
        try {
          trigger.focus({ preventScroll: true })
        } catch {
          /* noop */
        }
      }
    }
  }, [open])

  const onDragStart = (e: React.PointerEvent) => {
    if (locked) return
    const box = boxRef.current
    if (!box) return
    const y0 = e.clientY
    let dy = 0
    box.style.transition = 'none'
    const move = (ev: PointerEvent) => {
      dy = Math.max(0, ev.clientY - y0)
      box.style.transform = `translateY(${dy}px)`
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      box.style.transition = `transform 200ms ${EASE_OUT}`
      if (dy > 90) {
        box.style.transform = 'translateY(100%)'
        setTimeout(() => closeRef.current(), 160)
      } else {
        box.style.transform = ''
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  useEffect(() => {
    if (!open && boxRef.current) boxRef.current.style.transform = ''
  }, [open])

  if (!open) return null

  const label = ariaLabel ?? (typeof title === 'string' ? title : undefined)

  return createPortal(
    <Backdrop
      $mobile={mobile}
      $z={zIndex}
      onMouseDown={e => {
        if (e.target === e.currentTarget && !locked) onClose()
      }}
    >
      <Box
        ref={boxRef}
        role={role}
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        $mobile={mobile}
        $width={width}
        $pad={padding}
      >
        {mobile && <Handle aria-hidden onPointerDown={onDragStart} />}
        {(title || !hideClose) && (title || description) ? (
          <Head>
            <div>
              {title && <h2>{title}</h2>}
              {description && <p>{description}</p>}
            </div>
            {!hideClose && (
              <CloseButton aria-label="Close" onClick={onClose}>
                <X size={16} strokeWidth={2} />
              </CloseButton>
            )}
          </Head>
        ) : null}
        {children}
      </Box>
    </Backdrop>,
    document.body
  )
}

export default Dialog
