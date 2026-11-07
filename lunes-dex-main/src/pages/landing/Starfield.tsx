import React, { useEffect, useRef } from 'react'
import styled from 'styled-components'

type Star = {
  x: number
  y: number
  z: number
  t: number
  s: number
  c: string
}

type Shoot = { x: number; y: number; l: number }

type Props = {
  /** Normalised mouse position (-0.5..0.5), shared with the page parallax. */
  mouse: React.MutableRefObject<{ x: number; y: number }>
  reduced: boolean
}

const Canvas = styled.canvas`
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
`

/**
 * Fixed starfield: depth (z) drives size, brightness and parallax speed,
 * stars twinkle and a shooting star crosses now and then. The loop pauses
 * while the tab is hidden; with reduced motion a single static frame is drawn.
 */
export const Starfield: React.FC<Props> = ({ mouse, reduced }) => {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const c = ref.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return

    let dpr = 1
    const size = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      c.width = window.innerWidth * dpr
      c.height = window.innerHeight * dpr
    }
    size()

    const n = Math.round(Math.min(320, window.innerWidth * 0.22))
    const stars: Star[] = Array.from({ length: n }, () => ({
      x: Math.random(),
      y: Math.random() * 3,
      z: 0.2 + Math.random() * 0.8,
      t: Math.random() * 6.28,
      s: 0.4 + Math.random() * 1.3,
      c:
        Math.random() < 0.12
          ? '173,135,255'
          : Math.random() < 0.06
            ? '87,226,144'
            : '255,255,255'
    }))

    let shoot: Shoot | null = null
    let raf = 0
    let last = performance.now()

    const draw = (now: number) => {
      const dt = Math.min(50, now - last)
      last = now
      const W = c.width
      const H = c.height
      const y = window.scrollY || 0
      const mx = mouse.current.x
      ctx.clearRect(0, 0, W, H)
      for (const st of stars) {
        st.t += dt * 0.002 * st.z
        const px = ((((st.x + mx * 0.02 * st.z) % 1) + 1) % 1) * W
        let py = (st.y * H - y * dpr * st.z * 0.25) % (H * 3)
        if (py < 0) py += H * 3
        if (py > H) continue
        const a = (0.35 + 0.65 * Math.abs(Math.sin(st.t))) * st.z
        ctx.beginPath()
        ctx.fillStyle = `rgba(${st.c},${a.toFixed(3)})`
        ctx.arc(px, py, st.s * st.z * dpr, 0, 6.283)
        ctx.fill()
      }
      if (reduced) return
      if (!shoot && Math.random() < 0.004) {
        shoot = {
          x: Math.random() * W * 0.8 + W * 0.1,
          y: Math.random() * H * 0.4,
          l: 0
        }
      }
      if (shoot) {
        shoot.l += dt * 0.9 * dpr
        const len = Math.min(shoot.l, 140 * dpr)
        const ex = shoot.x + shoot.l
        const ey = shoot.y + shoot.l * 0.45
        const g = ctx.createLinearGradient(ex - len, ey - len * 0.45, ex, ey)
        g.addColorStop(0, 'rgba(202,175,255,0)')
        g.addColorStop(1, 'rgba(255,255,255,0.9)')
        ctx.strokeStyle = g
        ctx.lineWidth = 1.6 * dpr
        ctx.beginPath()
        ctx.moveTo(ex - len, ey - len * 0.45)
        ctx.lineTo(ex, ey)
        ctx.stroke()
        if (shoot.l > W * 0.5) shoot = null
      }
      raf = requestAnimationFrame(draw)
    }

    const start = () => {
      cancelAnimationFrame(raf)
      last = performance.now()
      raf = requestAnimationFrame(draw)
    }
    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(raf)
      else if (!reduced) start()
    }
    const onResize = () => {
      size()
      if (reduced) draw(performance.now())
    }
    // Reduced motion: static sky, redrawn only on scroll / resize.
    let pending = false
    const onScrollStatic = () => {
      if (pending) return
      pending = true
      raf = requestAnimationFrame(t => {
        pending = false
        draw(t)
      })
    }

    if (reduced) {
      draw(performance.now())
      window.addEventListener('scroll', onScrollStatic, { passive: true })
    } else {
      start()
      document.addEventListener('visibilitychange', onVisibility)
    }
    window.addEventListener('resize', onResize, { passive: true })

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScrollStatic)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [mouse, reduced])

  return <Canvas ref={ref} aria-hidden="true" />
}
