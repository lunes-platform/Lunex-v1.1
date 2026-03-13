/**
 * ToastProvider — Global toast notification system
 *
 * Usage:
 *   // Wrap app:
 *   <ToastProvider><App /></ToastProvider>
 *
 *   // In any component:
 *   const toast = useToast()
 *   toast.success('Swap completed!')
 *   toast.error('Transaction failed')
 *   toast.info('Waiting for signature...')
 */
import React, { createContext, useContext, useState, useCallback, useRef } from 'react'
import styled, { keyframes } from 'styled-components'
import { fadeInUp, timing, easing } from '../../styles/motion'

const slideOut = keyframes`
  from { opacity: 1; transform: translateX(0); }
  to { opacity: 0; transform: translateX(100%); }
`

type ToastVariant = 'success' | 'error' | 'info' | 'warning'

interface ToastItem {
    id: number
    message: string
    variant: ToastVariant
    exiting?: boolean
}

interface ToastContextType {
    success: (message: string) => void
    error: (message: string) => void
    info: (message: string) => void
    warning: (message: string) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

export const useToast = (): ToastContextType => {
    const ctx = useContext(ToastContext)
    if (!ctx) throw new Error('useToast must be used within ToastProvider')
    return ctx
}

const variantConfig: Record<ToastVariant, { bg: string; border: string; icon: string }> = {
    success: { bg: '#26D07C', border: '#26D07C44', icon: '✓' },
    error: { bg: '#FF284C', border: '#FF284C44', icon: '✗' },
    info: { bg: '#6C38FF', border: '#6C38FF44', icon: 'i' },
    warning: { bg: '#FE5F00', border: '#FE5F0044', icon: '!' },
}

const Container = styled.div`
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 9999;
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
  max-width: 380px;
  pointer-events: none;
`

const ToastCard = styled.div<{ variant: ToastVariant; exiting?: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  border-radius: 12px;
  background: #232323;
  border: 1px solid ${({ variant }) => variantConfig[variant].border};
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: #FFFFFF;
  pointer-events: auto;
  cursor: pointer;
  animation: ${({ exiting }) => (exiting ? slideOut : fadeInUp)}
    ${({ exiting }) => (exiting ? timing.fast : timing.smooth)}
    ${easing.decelerate} both;
  will-change: transform, opacity;
`

const Indicator = styled.div<{ variant: ToastVariant }>`
  width: 4px;
  height: 24px;
  border-radius: 2px;
  background: ${({ variant }) => variantConfig[variant].bg};
  flex-shrink: 0;
`

const Icon = styled.span`
  font-size: 16px;
  flex-shrink: 0;
`

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<ToastItem[]>([])
    const nextId = useRef(0)

    const addToast = useCallback((message: string, variant: ToastVariant) => {
        const id = nextId.current++
        setToasts((prev) => [...prev.slice(-4), { id, message, variant }])

        setTimeout(() => {
            setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)))
            setTimeout(() => {
                setToasts((prev) => prev.filter((t) => t.id !== id))
            }, 200)
        }, 4000)
    }, [])

    const dismiss = useCallback((id: number) => {
        setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)))
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id))
        }, 200)
    }, [])

    const api: ToastContextType = {
        success: useCallback((m: string) => addToast(m, 'success'), [addToast]),
        error: useCallback((m: string) => addToast(m, 'error'), [addToast]),
        info: useCallback((m: string) => addToast(m, 'info'), [addToast]),
        warning: useCallback((m: string) => addToast(m, 'warning'), [addToast]),
    }

    return (
        <ToastContext.Provider value={api}>
            {children}
            <Container>
                {toasts.map((t) => (
                    <ToastCard key={t.id} variant={t.variant} exiting={t.exiting} onClick={() => dismiss(t.id)}>
                        <Indicator variant={t.variant} />
                        <Icon>{variantConfig[t.variant].icon}</Icon>
                        {t.message}
                    </ToastCard>
                ))}
            </Container>
        </ToastContext.Provider>
    )
}
