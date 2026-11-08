import React, { useEffect, useRef, useState } from 'react'
import { fmtStat, StatFmt } from './data'

type Props = {
  value: number
  fmt: StatFmt
  reduced: boolean
  className?: string
}

const DURATION = 1600

/**
 * Counts 0 → value (ease-out quart, 1.6s) the first time it enters the
 * viewport. Renders the final value immediately with reduced motion.
 */
export const CountUp: React.FC<Props> = ({
  value,
  fmt,
  reduced,
  className
}) => {
  const ref = useRef<HTMLSpanElement>(null)
  const final = fmtStat(value, fmt)
  const [text, setText] = useState(final)

  useEffect(() => {
    const el = ref.current
    if (!el || reduced || !('IntersectionObserver' in window)) {
      setText(final)
      return
    }
    let raf = 0
    let started = false
    const run = () => {
      started = true
      const t0 = performance.now()
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / DURATION)
        const e = 1 - Math.pow(1 - p, 4)
        setText(p < 1 ? fmtStat(value * e, fmt) : final)
        if (p < 1) raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }
    // Start from zero only if the number is not visible yet.
    if (el.getBoundingClientRect().top > window.innerHeight * 0.9) {
      setText(fmtStat(0, fmt))
    }
    const io = new IntersectionObserver(
      entries => {
        if (!started && entries.some(en => en.isIntersecting)) {
          io.disconnect()
          run()
        }
      },
      { rootMargin: '0px 0px -10% 0px' }
    )
    io.observe(el)
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [value, fmt, final, reduced])

  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  )
}
