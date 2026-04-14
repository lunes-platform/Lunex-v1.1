import React, { useRef, useEffect } from 'react'
import styled from 'styled-components'

const Canvas = styled.canvas`
  width: 100%;
  height: 100%;
  display: block;
`

interface PnLChartProps {
  data: number[]
  color?: string
  height?: number
}

const PnLChart: React.FC<PnLChartProps> = ({
  data,
  color = '#26d07c',
  height = 48
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || data.length < 2) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()

    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    const w = rect.width
    const h = rect.height

    const min = Math.min(...data)
    const max = Math.max(...data)
    const range = max - min || 1

    const stepX = w / (data.length - 1)

    // Gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, h)
    gradient.addColorStop(0, color + '30')
    gradient.addColorStop(1, color + '00')

    ctx.beginPath()
    ctx.moveTo(0, h - ((data[0] - min) / range) * h * 0.85)

    for (let i = 1; i < data.length; i++) {
      const x = i * stepX
      const y = h - ((data[i] - min) / range) * h * 0.85
      ctx.lineTo(x, y)
    }

    // Fill
    ctx.lineTo(w, h)
    ctx.lineTo(0, h)
    ctx.closePath()
    ctx.fillStyle = gradient
    ctx.fill()

    // Line
    ctx.beginPath()
    ctx.moveTo(0, h - ((data[0] - min) / range) * h * 0.85)
    for (let i = 1; i < data.length; i++) {
      const x = i * stepX
      const y = h - ((data[i] - min) / range) * h * 0.85
      ctx.lineTo(x, y)
    }
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.stroke()
  }, [data, color])

  return <Canvas ref={canvasRef} style={{ height: `${height}px` }} />
}

export default PnLChart
