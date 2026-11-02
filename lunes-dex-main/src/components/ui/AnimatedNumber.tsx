/**
 * AnimatedNumber — indicator counter.
 *
 * - On mount: counts 0 → value in 900ms (ease-out cubic).
 * - On change: animates in 500ms and flashes green (up) or red (down).
 * - Prefix, suffix and decimals stay intact (pass `format`, or `text`).
 * - Reduced motion: renders the final value immediately.
 *
 * Accepts either a numeric `value` + `format`, or a preformatted `text`
 * (e.g. "$1,234.56 M") — the first number inside the text is animated.
 */
import React, { useEffect, useRef, useState } from 'react'

const NUM_RE = /\d[\d,]*(?:\.\d+)?/

const parseText = (txt: string) => {
  const m = txt.match(NUM_RE)
  if (!m || m.index === undefined) return null
  const raw = m[0]
  return {
    pre: txt.slice(0, m.index),
    suf: txt.slice(m.index + raw.length),
    val: parseFloat(raw.replace(/,/g, '')),
    dec: (raw.split('.')[1] || '').length,
    comma: raw.includes(',') || parseFloat(raw.replace(/,/g, '')) >= 10000
  }
}

const fmtNum = (v: number, dec: number, comma: boolean) => {
  let s = v.toFixed(dec)
  if (comma) {
    const [i, d] = s.split('.')
    s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? '.' + d : '')
  }
  return s
}

const reduced = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

type Props = {
  value?: number
  format?: (v: number) => string
  text?: string
  className?: string
  style?: React.CSSProperties
  /** Disable the change flash (e.g. live tickers that already flash). */
  noFlash?: boolean
}

export const AnimatedNumber: React.FC<Props> = ({
  value,
  format,
  text,
  className,
  style,
  noFlash
}) => {
  const target =
    text ?? (format ? format(value ?? 0) : String(value ?? 0))
  const parsed = parseText(target)
  const [out, setOut] = useState(() =>
    parsed && !reduced() ? parsed.pre + fmtNum(0, parsed.dec, parsed.comma) + parsed.suf : target
  )
  const fromRef = useRef<number | null>(null)
  const spanRef = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    const p = parseText(target)
    clearTimeout(timer.current)
    if (!p || reduced()) {
      setOut(target)
      fromRef.current = p?.val ?? null
      return
    }
    const first = fromRef.current === null
    const from = first ? 0 : (fromRef.current as number)
    fromRef.current = p.val
    if (from === p.val) {
      setOut(target)
      return
    }
    if (!first && !noFlash && spanRef.current?.animate) {
      spanRef.current.animate(
        [{ color: p.val > from ? '#57E290' : '#FF807E' }, {}],
        { duration: 900, easing: 'ease-out' }
      )
    }
    const D = first ? 900 : 500
    const t0 = performance.now()
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / D)
      const e = 1 - Math.pow(1 - k, 3)
      if (k < 1) {
        setOut(p.pre + fmtNum(from + (p.val - from) * e, p.dec, p.comma) + p.suf)
        timer.current = setTimeout(step, 16)
      } else {
        setOut(target)
      }
    }
    step()
    return () => clearTimeout(timer.current)
  }, [target, noFlash])

  return (
    <span
      ref={spanRef}
      className={className}
      style={{ fontVariantNumeric: 'tabular-nums', ...style }}
    >
      {out}
    </span>
  )
}

export default AnimatedNumber
