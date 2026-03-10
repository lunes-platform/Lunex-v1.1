/**
 * useAnimatedCounter — Smoothly animates a number from oldValue to newValue.
 *
 * Usage:
 *   const displayValue = useAnimatedCounter(price, { decimals: 2, duration: 600 })
 *
 *   <span className={price > prevPrice ? 'up' : 'down'}>{displayValue}</span>
 */
import { useState, useEffect, useRef } from 'react'

interface Options {
    decimals?: number
    duration?: number  // ms
    prefix?: string
    suffix?: string
}

export function useAnimatedCounter(
    target: number,
    { decimals = 0, duration = 500, prefix = '', suffix = '' }: Options = {},
): string {
    const [current, setCurrent] = useState(target)
    const startRef = useRef(target)
    const startTimeRef = useRef<number | null>(null)
    const frameRef = useRef<number | null>(null)

    useEffect(() => {
        // Skip animation if prefers-reduced-motion
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setCurrent(target)
            return
        }

        const from = startRef.current
        startTimeRef.current = null

        const animate = (timestamp: number) => {
            if (!startTimeRef.current) startTimeRef.current = timestamp
            const elapsed = timestamp - startTimeRef.current
            const progress = Math.min(elapsed / duration, 1)

            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3)
            const value = from + (target - from) * eased

            setCurrent(value)

            if (progress < 1) {
                frameRef.current = requestAnimationFrame(animate)
            } else {
                startRef.current = target
            }
        }

        if (frameRef.current) cancelAnimationFrame(frameRef.current)
        frameRef.current = requestAnimationFrame(animate)

        return () => {
            if (frameRef.current) cancelAnimationFrame(frameRef.current)
        }
    }, [target, duration])

    const formatted = current.toFixed(decimals)
    return `${prefix}${formatted}${suffix}`
}

/**
 * useFlashOnChange — Returns 'up' | 'down' | null when a value changes.
 * Use this to apply CSS classes that flash green/red on metric changes.
 *
 * Usage:
 *   const flash = useFlashOnChange(price)
 *   <span style={{ color: flash === 'up' ? '#26D07C' : flash === 'down' ? '#FF284C' : 'inherit' }}>
 */
export function useFlashOnChange(value: number, duration = 800): 'up' | 'down' | null {
    const [flash, setFlash] = useState<'up' | 'down' | null>(null)
    const prevRef = useRef(value)

    useEffect(() => {
        if (value !== prevRef.current) {
            setFlash(value > prevRef.current ? 'up' : 'down')
            prevRef.current = value

            const t = setTimeout(() => setFlash(null), duration)
            return () => clearTimeout(t)
        }
    }, [value, duration])

    return flash
}
