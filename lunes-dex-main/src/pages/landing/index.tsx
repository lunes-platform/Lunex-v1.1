import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import {
  Zap,
  Wallet,
  Waves,
  Gift,
  ArrowRight,
  ExternalLink,
  Github,
  Twitter,
  MessageCircle,
  Send,
  ArrowDown,
  Layers,
  Coins,
  Globe,
  Bot,
  Copy,
  BookOpen,
  TrendingUp,
  Activity,
  ChevronRight,
  Star,
  Lock,
  Target
} from 'lucide-react'
import * as S from './styles'
import { LunexLogo } from '../../components/LunexLogo'
import { useWebMCP } from '../../hooks/useWebMCP'

// Animated counter
const Counter: React.FC<{ end: number; suffix?: string; prefix?: string }> = ({
  end,
  suffix = '',
  prefix = ''
}) => {
  const [val, setVal] = useState(0)
  useEffect(() => {
    let n = 0
    const inc = end / 125
    const t = setInterval(() => {
      n += inc
      if (n >= end) {
        setVal(end)
        clearInterval(t)
      } else {
        setVal(Math.floor(n))
      }
    }, 16)
    return () => clearInterval(t)
  }, [end])
  return (
    <>
      {prefix}
      {val.toLocaleString()}
      {suffix}
    </>
  )
}

export const Landing: React.FC = () => {
  const navigate = useNavigate()
  const [scrolled, setScrolled] = useState(false)

  // Initialize WebMCP for AI agent interaction
  useWebMCP()

  // Capture referral code from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ref = params.get('ref')
    if (ref && ref.length >= 4) {
      localStorage.setItem('lunex_referral_code', ref)
    }
  }, [])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', onScroll, { passive: true })

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    )

    const revealElements = document.querySelectorAll('.reveal-on-scroll')
    revealElements.forEach(el => observer.observe(el))

    return () => {
      window.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [])

  return (
    <S.Page>
      <Helmet>
        <title>Lunex — Trade, Automate and Scale on Lunes</title>
        <meta
          name="description"
          content="Swap, spot trade, deploy AI agents, copy top strategies, and earn rewards in a unified trading protocol built on the Lunes blockchain."
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </Helmet>

      {/* NAV */}
      <S.Nav $scrolled={scrolled}>
        <S.Logo>
          <LunexLogo width="135px" navHome />
        </S.Logo>
        <S.NavLinks>
          <S.NavLink href="#how-it-works">Protocol</S.NavLink>
          <S.NavLink href="#ai-agents">AI Agents</S.NavLink>
          <S.NavLink href="#copytrade">Copytrade</S.NavLink>
          <S.NavLink href="#ecosystem">Ecosystem</S.NavLink>
          <S.NavLink
            href="#"
            onClick={(e: React.MouseEvent) => {
              e.preventDefault()
              navigate('/docs')
            }}
          >
            Docs
          </S.NavLink>
        </S.NavLinks>
        <S.ConnectBtn onClick={() => navigate('/swap')}>
          Launch App
        </S.ConnectBtn>
      </S.Nav>

      {/* HERO */}
      <S.HeroSection>
        <S.HeroTitle $delay="0.1s">
          Trade.
          <br />
          Automate.
          <br />
          <span>Scale.</span>
        </S.HeroTitle>
        <S.HeroSub $delay="0.25s">
          Swap, spot trade, deploy AI agents, copy top strategies,
          <br className="desktop-br" /> and earn rewards in one unified protocol
          on Lunes.
        </S.HeroSub>
        <S.HeroBtns $delay="0.35s">
          <S.PrimaryBtn
            onClick={() => navigate('/swap')}
            {...({
              'to-name': 'launchApp',
              'to-description': 'Launch the Lunex DEX trading interface'
            } as any)}
          >
            Launch App <ArrowRight />
          </S.PrimaryBtn>
          <S.SecBtn onClick={() => navigate('/docs')}>
            Explore Docs <ExternalLink />
          </S.SecBtn>
        </S.HeroBtns>

        {/* Token Orbit Visual */}
        <S.HeroOrbit $delay="0.5s">
          <S.OrbitCenter>
            <img src="/img/lunes.svg" alt="Lunes" />
          </S.OrbitCenter>

          {/* Ring 1 - Inner */}
          <S.OrbitRing $radius={130} $duration={20}>
            {[
              { a: 0, s: 'LUNES', img: '/img/lunes-green.svg' },
              { a: 90, s: 'BTC' },
              { a: 180, s: 'lUSDT', img: '/img/lusdt.svg' },
              { a: 270, s: 'ETH' }
            ].map((t, i) => (
              <S.OrbitTokenWrapper key={i} $angle={t.a} $radius={130}>
                <S.OrbitTokenInner $duration={20} $angle={t.a}>
                  <S.OrbitTokenFloat $delay={i * 0.5}>
                    {t.img ? <img src={t.img} alt={t.s} /> : <span>{t.s}</span>}
                  </S.OrbitTokenFloat>
                </S.OrbitTokenInner>
              </S.OrbitTokenWrapper>
            ))}
          </S.OrbitRing>

          {/* Ring 2 - Middle */}
          <S.OrbitRing $radius={220} $duration={35}>
            {(
              [
                { a: 45, s: 'SOL' },
                { a: 117, s: 'BNB' },
                { a: 189, s: 'XRP' },
                { a: 261, s: 'MATIC' },
                { a: 333, s: 'ADA' }
              ] as { a: number; s: string; img?: string }[]
            ).map((t, i) => (
              <S.OrbitTokenWrapper key={i} $angle={t.a} $radius={220}>
                <S.OrbitTokenInner $duration={35} $angle={t.a}>
                  <S.OrbitTokenFloat $delay={i * 0.7}>
                    {t.img ? <img src={t.img} alt={t.s} /> : <span>{t.s}</span>}
                  </S.OrbitTokenFloat>
                </S.OrbitTokenInner>
              </S.OrbitTokenWrapper>
            ))}
          </S.OrbitRing>

          {/* Ring 3 - Outer */}
          <S.OrbitRing $radius={310} $duration={55}>
            {(
              [
                { a: 30, s: 'AVAX' },
                { a: 90, s: 'LINK' },
                { a: 150, s: 'DOGE' },
                { a: 210, s: 'DOT' },
                { a: 270, s: 'UNI' },
                { a: 330, s: 'PEPE' }
              ] as { a: number; s: string; img?: string }[]
            ).map((t, i) => (
              <S.OrbitTokenWrapper key={i} $angle={t.a} $radius={310}>
                <S.OrbitTokenInner $duration={55} $angle={t.a}>
                  <S.OrbitTokenFloat $delay={i * 0.4}>
                    {t.img ? <img src={t.img} alt={t.s} /> : <span>{t.s}</span>}
                  </S.OrbitTokenFloat>
                </S.OrbitTokenInner>
              </S.OrbitTokenWrapper>
            ))}
          </S.OrbitRing>
        </S.HeroOrbit>

        {/* Swap card floating below hero */}
        <S.HeroSwapCard $delay="0.55s">
          <S.SwapHeader>
            <h3>Live Swap Preview</h3>
            <span>Default slippage: 0.5%</span>
          </S.SwapHeader>
          <S.SwapTopStats>
            <S.SwapTopStat>
              <strong>Best route</strong>
              <span>Auto-optimized</span>
            </S.SwapTopStat>
            <S.SwapTopStat>
              <strong>Wallet control</strong>
              <span>Non-custodial</span>
            </S.SwapTopStat>
          </S.SwapTopStats>
          <S.SwapField $active>
            <S.SwapFieldLeft>
              <img src="/img/lunes-green.svg" alt="LUNES" />
              <span>LUNES</span>
            </S.SwapFieldLeft>
            <S.SwapFieldRight>
              <div className="amount">1,000</div>
              <div className="usd">≈ $45.00</div>
            </S.SwapFieldRight>
          </S.SwapField>
          <S.SwapArrow>
            <div>
              <ArrowDown />
            </div>
          </S.SwapArrow>
          <S.SwapField>
            <S.SwapFieldLeft>
              <img src="/img/lusdt.svg" alt="lUSDT" />
              <span>lUSDT</span>
            </S.SwapFieldLeft>
            <S.SwapFieldRight>
              <div className="amount">45.00</div>
              <div className="usd">≈ $45.00</div>
            </S.SwapFieldRight>
          </S.SwapField>
          <S.SwapButton
            onClick={() => navigate('/swap')}
            {...({
              'to-name': 'startSwap',
              'to-description':
                'Open the token swap interface to exchange LUNES for lUSDT'
            } as any)}
          >
            Review Route
          </S.SwapButton>
          <S.SwapInfo>
            <span>Fee: 0.5%</span>
            <span>Est. execution: &lt;3s</span>
          </S.SwapInfo>
        </S.HeroSwapCard>
      </S.HeroSection>

      {/* STATS BAR */}
      <S.StatsBar className="reveal-on-scroll" $delay="0.1s">
        <S.StatsGrid>
          <S.StatItem>
            <S.StatVal>
              $<Counter end={12} suffix="M+" />
            </S.StatVal>
            <S.StatLabel>Value secured</S.StatLabel>
          </S.StatItem>
          <S.StatItem>
            <S.StatVal>
              <Counter end={50} suffix="K+" />
            </S.StatVal>
            <S.StatLabel>Trades executed</S.StatLabel>
          </S.StatItem>
          <S.StatItem>
            <S.StatVal>
              <Counter end={10} suffix="K+" />
            </S.StatVal>
            <S.StatLabel>Active wallets</S.StatLabel>
          </S.StatItem>
          <S.StatItem>
            <S.StatVal>&lt;3s</S.StatVal>
            <S.StatLabel>Execution speed</S.StatLabel>
          </S.StatItem>
          <S.StatItem>
            <S.StatVal>100%</S.StatVal>
            <S.StatLabel>Non-custodial</S.StatLabel>
          </S.StatItem>
        </S.StatsGrid>
      </S.StatsBar>

      {/* HOW LUNEX WORKS */}
      <S.FlowSection id="how-it-works">
        <S.SectionLabel className="reveal-on-scroll">
          Protocol Architecture
        </S.SectionLabel>
        <S.STitle className="reveal-on-scroll">
          How Lunex <span>works</span>
        </S.STitle>
        <S.SSub className="reveal-on-scroll">
          A unified on-chain execution layer where every trading mode feeds into
          the same liquidity and rewards system.
        </S.SSub>

        <S.FlowDiagram className="reveal-on-scroll">
          <S.FlowSVG xmlns="http://www.w3.org/2000/svg">
            {/* Input Lines (Left to Center) */}
            <path className="flow-line" d="M220,95 Q340,95 370,250" />
            <path className="flow-anim" d="M220,95 Q340,95 370,250" />

            <path className="flow-line" d="M220,185 Q340,185 370,250" />
            <path className="flow-anim" d="M220,185 Q340,185 370,250" />

            <path className="flow-line" d="M220,275 Q340,275 370,250" />
            <path className="flow-anim" d="M220,275 Q340,275 370,250" />

            <path className="flow-line" d="M220,365 Q340,365 370,250" />
            <path className="flow-anim" d="M220,365 Q340,365 370,250" />

            {/* Output Lines (Center to Right) */}
            <path className="flow-line" d="M530,250 Q560,140 680,140" />
            <path className="flow-anim-out" d="M530,250 Q560,140 680,140" />

            <path className="flow-line" d="M530,250 Q560,250 680,250" />
            <path className="flow-anim-out" d="M530,250 Q560,250 680,250" />

            <path className="flow-line" d="M530,250 Q560,360 680,360" />
            <path className="flow-anim-out" d="M530,250 Q560,360 680,360" />
          </S.FlowSVG>

          {/* LEFT: Target Inputs */}
          <S.FlowNodeGroup $side="left">
            <S.FlowNode $accent="#00E5A0">
              <Waves />
              <div className="content">
                <span>AMM Swap</span>
                <small>Instant conversion</small>
              </div>
            </S.FlowNode>
            <S.FlowNode $accent="#FF5C00">
              <Activity />
              <div className="content">
                <span>Spot Orderbook</span>
                <small>Limit & Market</small>
              </div>
            </S.FlowNode>
            <S.FlowNode $accent="#FFD700">
              <Bot />
              <div className="content">
                <span>AI Agents</span>
                <small>Autonomous execution</small>
              </div>
            </S.FlowNode>
            <S.FlowNode $accent="#00B8D9">
              <Copy />
              <div className="content">
                <span>Copy Trading</span>
                <small>Social replication</small>
              </div>
            </S.FlowNode>
          </S.FlowNodeGroup>

          {/* CENTER CORE */}
          <S.FlowMobileArrow />
          <S.FlowCore>
            <Lock />
            <span>Smart Contracts</span>
          </S.FlowCore>
          <S.FlowMobileArrow />

          {/* RIGHT: Output Yields */}
          <S.FlowNodeGroup $side="right">
            <S.FlowNode
              $accent="#FF9500"
              style={{ transform: 'translateY(-10px)' }}
            >
              <Gift />
              <div className="content">
                <span>Rewards Pool</span>
                <small>Real yield burn/buyback</small>
              </div>
            </S.FlowNode>
            <S.FlowNode $accent="#00E5A0">
              <Layers />
              <div className="content">
                <span>Liquidity Providers</span>
                <small>Fee distribution</small>
              </div>
            </S.FlowNode>
            <S.FlowNode
              $accent="#A0F0D0"
              style={{ transform: 'translateY(10px)' }}
            >
              <Coins />
              <div className="content">
                <span>Staking</span>
                <small>LUNES Lockups</small>
              </div>
            </S.FlowNode>
          </S.FlowNodeGroup>
        </S.FlowDiagram>
      </S.FlowSection>

      {/* ASYMMETRIC LIQUIDITY */}
      <S.AsymSection id="asymmetric-liquidity">
        {/* ── HEADER CENTRAL ── */}
        <S.AsymHeader className="reveal-on-scroll">
          <S.AsymStat>
            <Layers size={11} />
            Asymmetric Protocol
          </S.AsymStat>
          <S.AsymTitle>
            Parametric curves for <span>advanced&nbsp;liquidity</span>
          </S.AsymTitle>
          <S.AsymSubtitle>
            Break free from symmetric bonding. Deploy capital inside
            precisely-defined asymmetric ranges to capture maximum fees during
            volatility — managed by humans or autonomous AI agents.
          </S.AsymSubtitle>
        </S.AsymHeader>

        {/* ── CONTENT + CHART ── */}
        <S.AsymGrid>
          <S.AsymContent>
            <S.AsymFeatureList>
              <S.AsymFeature
                className="reveal-on-scroll"
                $delay="0.1s"
                $accent="#00E5A0"
              >
                <h4>
                  <Target size={18} color="#00E5A0" /> Hyper-Concentration
                </h4>
                <p>
                  Deploy capital specifically where the volume happens.
                  Concentrate your range inside tight 10% deviations to maximize
                  fee capture per dollar.
                </p>
              </S.AsymFeature>
              <S.AsymFeature
                className="reveal-on-scroll"
                $delay="0.2s"
                $accent="#FFD700"
              >
                <h4>
                  <Bot size={18} color="#FFD700" /> AI-Driven Boundaries
                </h4>
                <p>
                  The LUNEX Agentic Swarm autonomously shifts your liquidity
                  bands, predicting impermanent loss windows before market moves
                  occur.
                </p>
              </S.AsymFeature>
              <S.AsymFeature
                className="reveal-on-scroll"
                $delay="0.3s"
                $accent="#FF3366"
              >
                <h4>
                  <Zap size={18} color="#FF3366" /> Single-Sided Exposure
                </h4>
                <p>
                  Provide liquidity without holding the paired asset. The
                  protocol dynamically hedges your position using on-chain
                  synthetic derivatives.
                </p>
              </S.AsymFeature>
            </S.AsymFeatureList>
          </S.AsymContent>

          {/* ── CHART ── */}
          <S.AsymChartWrap className="reveal-on-scroll" $delay="0.15s">
            {/* Legenda topo-direita */}
            <S.ChartLabels>
              <S.ChartLabel $color="#00E5A0">
                Concentrated&nbsp;Liquidity
              </S.ChartLabel>
              <S.ChartLabel $color="rgba(255,255,255,0.2)">
                Constant&nbsp;Product&nbsp;(xy=k)
              </S.ChartLabel>
            </S.ChartLabels>

            <S.AsymSVG
              viewBox="0 0 560 340"
              preserveAspectRatio="xMidYMid meet"
            >
              <defs>
                {/* Gradiente verde sob a curva concentrada */}
                <linearGradient id="fillGreen" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00E5A0" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#00E5A0" stopOpacity="0" />
                </linearGradient>
                {/* Brilho neon na curva */}
                <filter id="neonGlow">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                {/* Clip da área do gráfico */}
                <clipPath id="areaClip">
                  <rect x="60" y="15" width="480" height="265" />
                </clipPath>
              </defs>

              {/* ── Grid sutil ── */}
              {[130, 200, 270, 340, 410].map(x => (
                <line
                  key={x}
                  x1={x}
                  y1="15"
                  x2={x}
                  y2="280"
                  stroke="rgba(0,229,160,0.05)"
                  strokeWidth="1"
                />
              ))}
              {[60, 120, 180, 240].map(y => (
                <line
                  key={y}
                  x1="60"
                  y1={y}
                  x2="540"
                  y2={y}
                  stroke="rgba(255,255,255,0.04)"
                  strokeWidth="1"
                />
              ))}

              {/* ── Eixos ── */}
              <line x1="60" y1="280" x2="540" y2="280" className="axis-x" />
              <line x1="60" y1="15" x2="60" y2="280" className="axis-y" />

              {/* Setas nos eixos */}
              <polygon
                points="540,276 548,280 540,284"
                fill="rgba(255,255,255,0.08)"
              />
              <polygon
                points="56,15 60,7 64,15"
                fill="rgba(255,255,255,0.08)"
              />

              {/* ── Labels eixo X ── */}
              <text x="130" y="296" className="svg-label" textAnchor="middle">
                0.85
              </text>
              <text x="200" y="296" className="svg-label" textAnchor="middle">
                0.92
              </text>
              <text
                x="270"
                y="296"
                className="svg-label"
                textAnchor="middle"
                style={{ fill: 'rgba(0,229,160,0.6)' }}
              >
                1.00
              </text>
              <text x="340" y="296" className="svg-label" textAnchor="middle">
                1.08
              </text>
              <text x="410" y="296" className="svg-label" textAnchor="middle">
                1.15
              </text>
              <text
                x="300"
                y="316"
                className="svg-label"
                textAnchor="middle"
                style={{ letterSpacing: '2px', fontSize: '9px' }}
              >
                PRICE RATIO
              </text>

              {/* ── Labels eixo Y ── */}
              <text x="52" y="65" className="svg-label" textAnchor="end">
                High
              </text>
              <text x="52" y="175" className="svg-label" textAnchor="end">
                Mid
              </text>
              <text x="52" y="278" className="svg-label" textAnchor="end">
                Low
              </text>
              <text
                x="18"
                y="160"
                className="svg-label"
                textAnchor="middle"
                transform="rotate(-90,18,160)"
                style={{ letterSpacing: '2px', fontSize: '9px' }}
              >
                LIQUIDITY
              </text>

              {/* ── Zona AI Range ── */}
              <rect
                x="225"
                y="20"
                width="120"
                height="260"
                rx="2"
                className="ai-zone"
              />
              {/* Linha Superior da zona */}
              <line
                x1="225"
                y1="20"
                x2="345"
                y2="20"
                stroke="rgba(0,229,160,0.3)"
                strokeWidth="1"
                strokeDasharray="4 2"
              />
              {/* Movido para a esquerda para não colidir com Current Price */}
              <text
                x="260"
                y="32"
                className="svg-label-green"
                textAnchor="end"
                fontSize="9"
                letterSpacing="1.5"
              >
                AI RANGE
              </text>

              {/* ── Curva base xy=k ── */}
              {/* Curva monotônica crescente, representando x*y=k (quanto mais preço, menos liquidez) */}
              <path
                d="M 60 275 C 120 265, 170 240, 220 210 C 250 192, 265 180, 270 175 C 310 148, 370 110, 440 75 C 480 55, 510 40, 540 28"
                className="base-curve"
                clipPath="url(#areaClip)"
              />

              {/* ── Curva concentrada verde (sino estreito centrado em 1.00) ── */}
              <path
                d="M 60 278 C 130 276, 195 268, 230 240 C 250 224, 260 200, 268 165 C 272 142, 270 100, 270 35 C 270 35, 270 35, 270 35 C 270 100, 270 142, 272 165 C 278 200, 288 224, 308 240 C 345 268, 408 276, 480 278 L 540 278"
                className="active-curve"
                clipPath="url(#areaClip)"
                filter="url(#neonGlow)"
              />

              {/* Fill verde sob a curva concentrada */}
              <path
                d="M 60 278 C 130 276, 195 268, 230 240 C 250 224, 260 200, 268 165 C 272 142, 270 100, 270 35 C 270 100, 272 142, 272 165 C 278 200, 288 224, 308 240 C 345 268, 408 276, 480 278 L 540 278 L 540 280 L 60 280 Z"
                fill="url(#fillGreen)"
                clipPath="url(#areaClip)"
              />

              {/* ── Ponto de preço (topo do sino) ── */}
              <circle cx="270" cy="35" r="5" className="price-dot" />
              {/* Linha vertical de preço */}
              <line
                x1="270"
                y1="44"
                x2="270"
                y2="278"
                stroke="rgba(0,229,160,0.12)"
                strokeWidth="1"
                strokeDasharray="4 3"
              />
              {/* Movido para a direita para não colidir com AI RANGE */}
              <text
                x="280"
                y="32"
                className="svg-label-green"
                textAnchor="start"
                fontSize="9"
              >
                Current Price
              </text>

              {/* ── HUD Metrics dentro do SVG ── */}
              {/* Capital Efficiency */}
              <text
                x="80"
                y="55"
                fill="#00E5A0"
                fontFamily="Space Grotesk, sans-serif"
                fontSize="18"
                fontWeight="800"
              >
                8.4×
              </text>
              <text
                x="80"
                y="69"
                className="svg-label"
                style={{ fontSize: '8px', letterSpacing: '1px' }}
              >
                CAPITAL EFF.
              </text>

              {/* APY */}
              <text
                x="440"
                y="110"
                fill="#FFD700"
                fontFamily="Space Grotesk, sans-serif"
                fontSize="18"
                fontWeight="800"
                textAnchor="middle"
              >
                142%
              </text>
              <text
                x="440"
                y="124"
                className="svg-label"
                textAnchor="middle"
                style={{ fontSize: '8px', letterSpacing: '1px' }}
              >
                AVG APY (AI)
              </text>

              {/* IL Reduction */}
              <text
                x="440"
                y="220"
                fill="#FF3366"
                fontFamily="Space Grotesk, sans-serif"
                fontSize="18"
                fontWeight="800"
                textAnchor="middle"
              >
                -12%
              </text>
              <text
                x="440"
                y="234"
                className="svg-label"
                textAnchor="middle"
                style={{ fontSize: '8px', letterSpacing: '1px' }}
              >
                IL REDUCTION
              </text>
            </S.AsymSVG>
          </S.AsymChartWrap>
        </S.AsymGrid>
      </S.AsymSection>

      {/* TRADING MODES */}
      <S.ModesSection id="trading-modes">
        <S.SectionLabel className="reveal-on-scroll">
          Multi-Layer Trading
        </S.SectionLabel>
        <S.STitle className="reveal-on-scroll">
          Four ways to <span>trade</span>
        </S.STitle>
        <S.SSub className="reveal-on-scroll">
          From instant swaps to fully autonomous AI strategies — choose the mode
          that fits your edge.
        </S.SSub>
        <S.ModesGrid>
          <S.ModeCard
            className="reveal-on-scroll"
            $delay="0.05s"
            $accent="#00E5A0"
            onClick={() => navigate('/swap')}
          >
            <S.ModeTag>Layer 1</S.ModeTag>
            <S.ModeIcon $accent="#00E5A0">
              <Waves size={28} />
            </S.ModeIcon>
            <S.ModeTitle>AMM Swap</S.ModeTitle>
            <S.ModeDesc>
              Instant token conversion with auto-optimized routing across all
              available liquidity pools.
            </S.ModeDesc>
            <S.ModeStats>
              <span>&lt;3s execution</span>
              <span>0.5% fee</span>
            </S.ModeStats>
          </S.ModeCard>
          <S.ModeCard
            className="reveal-on-scroll"
            $delay="0.1s"
            $accent="#FF5C00"
            onClick={() => navigate('/spot')}
          >
            <S.ModeTag>Layer 2</S.ModeTag>
            <S.ModeIcon $accent="#FF5C00">
              <Activity size={28} />
            </S.ModeIcon>
            <S.ModeTitle>Spot Orderbook</S.ModeTitle>
            <S.ModeDesc>
              Place limit and market orders with precise price control on the
              Lunex on-chain orderbook.
            </S.ModeDesc>
            <S.ModeStats>
              <span>Limit orders</span>
              <span>Price precision</span>
            </S.ModeStats>
          </S.ModeCard>
          <S.ModeCard
            className="reveal-on-scroll"
            $delay="0.15s"
            $accent="#FFD700"
            onClick={() => navigate('/agent')}
          >
            <S.ModeTag>Layer 3</S.ModeTag>
            <S.ModeIcon $accent="#FFD700">
              <Bot size={28} />
            </S.ModeIcon>
            <S.ModeTitle>AI Agents</S.ModeTitle>
            <S.ModeDesc>
              Deploy autonomous trading bots powered by AI. Set your strategy
              once and let agents execute 24/7.
            </S.ModeDesc>
            <S.ModeStats>
              <span>24/7 execution</span>
              <span>No manual trading</span>
            </S.ModeStats>
          </S.ModeCard>
          <S.ModeCard
            className="reveal-on-scroll"
            $delay="0.2s"
            $accent="#A0F0D0"
            onClick={() => navigate('/spot/copytrade')}
          >
            <S.ModeTag>Layer 4</S.ModeTag>
            <S.ModeIcon $accent="#A0F0D0">
              <Copy size={28} />
            </S.ModeIcon>
            <S.ModeTitle>Copy Trading</S.ModeTitle>
            <S.ModeDesc>
              Follow the top traders on Lunes, allocate capital, and
              automatically replicate their strategies in real-time.
            </S.ModeDesc>
            <S.ModeStats>
              <span>1-click allocation</span>
              <span>Risk-controlled</span>
            </S.ModeStats>
          </S.ModeCard>
        </S.ModesGrid>
      </S.ModesSection>

      {/* AI AGENTS / OPENCLAW */}
      <S.AgentSection id="ai-agents">
        <S.AgentInner>
          <S.AgentLeft>
            <S.SectionLabel className="reveal-on-scroll">
              OpenClaw Integration
            </S.SectionLabel>
            <S.STitle
              style={{ textAlign: 'left' }}
              className="reveal-on-scroll"
            >
              Deploy <span>Autonomous</span>
              <br />
              Trading Agents
            </S.STitle>
            <S.SSub
              style={{ textAlign: 'left', margin: '0 0 40px' }}
              className="reveal-on-scroll"
            >
              Connect your OpenClaw bot, define your strategy parameters, and
              let AI agents execute trades on your behalf — with no manual
              intervention required.
            </S.SSub>
            <S.AgentSteps className="reveal-on-scroll">
              <S.AgentStep>
                <S.AgentStepNum>01</S.AgentStepNum>
                <S.AgentStepBody>
                  <h4>Connect OpenClaw</h4>
                  <p>
                    Pair your bot with Lunex via the MCP SDK. One-time setup,
                    fully on-chain.
                  </p>
                </S.AgentStepBody>
              </S.AgentStep>
              <S.AgentStep>
                <S.AgentStepNum>02</S.AgentStepNum>
                <S.AgentStepBody>
                  <h4>Define Strategy</h4>
                  <p>
                    Set risk limits, target pairs, entry/exit conditions, and
                    execution cadence.
                  </p>
                </S.AgentStepBody>
              </S.AgentStep>
              <S.AgentStep>
                <S.AgentStepNum>03</S.AgentStepNum>
                <S.AgentStepBody>
                  <h4>Automate & Collect</h4>
                  <p>
                    Your agent executes 24/7. Track performance on-chain and
                    collect rewards automatically.
                  </p>
                </S.AgentStepBody>
              </S.AgentStep>
            </S.AgentSteps>
            <S.PrimaryBtn
              className="reveal-on-scroll"
              onClick={() => navigate('/agent')}
              style={{ marginTop: 32, width: 'fit-content' }}
            >
              Explore AI Agents <ArrowRight />
            </S.PrimaryBtn>
          </S.AgentLeft>
          <S.AgentRight className="reveal-on-scroll">
            <S.AgentTerminal>
              <S.TerminalBar>
                <span className="dot red" />
                <span className="dot yellow" />
                <span className="dot green" />
                <span className="title">openclaw-agent.log</span>
              </S.TerminalBar>
              <S.TerminalBody>
                <S.TerminalLine $color="#888">
                  $ agent --start lunex-strategy-v2
                </S.TerminalLine>
                <S.TerminalLine $color="#00E5A0" $delay="0.2s">
                  ✓ Connected to Lunex protocol
                </S.TerminalLine>
                <S.TerminalLine $color="#888" $delay="0.4s">
                  Monitoring LUNES/lUSDT pair...
                </S.TerminalLine>
                <S.TerminalLine $color="#FFD700" $delay="0.6s">
                  ⚡ Signal detected: BUY at 0.04512
                </S.TerminalLine>
                <S.TerminalLine $color="#00E5A0" $delay="0.8s">
                  ✓ Order executed: 1,000 LUNES
                </S.TerminalLine>
                <S.TerminalLine $color="#888" $delay="1s">
                  Holding position... PnL: +2.4%
                </S.TerminalLine>
                <S.TerminalLine $color="#FFD700" $delay="1.2s">
                  ⚡ Signal detected: SELL at 0.04621
                </S.TerminalLine>
                <S.TerminalLine $color="#00E5A0" $delay="1.4s">
                  ✓ Order executed. Profit: +$10.90
                </S.TerminalLine>
                <S.TerminalLine $color="#888" $delay="1.6s">
                  Cycle complete. Next scan in 30s...
                </S.TerminalLine>
                <S.TerminalCursor />
              </S.TerminalBody>
            </S.AgentTerminal>
          </S.AgentRight>
        </S.AgentInner>
      </S.AgentSection>

      {/* COPY TRADING */}
      <S.Section id="copytrade">
        <S.SectionLabel className="reveal-on-scroll">
          Social Trading
        </S.SectionLabel>
        <S.STitle className="reveal-on-scroll">
          Follow top traders. <span>Earn automatically.</span>
        </S.STitle>
        <S.SSub className="reveal-on-scroll">
          Allocate capital to proven strategies, copy trades in real-time, and
          earn proportional returns — with full on-chain transparency.
        </S.SSub>
        <S.LeaderGrid>
          <S.LeaderCard className="reveal-on-scroll" $delay="0.05s" $rank={1}>
            <S.LeaderRank>#1</S.LeaderRank>
            <S.LeaderInfo>
              <S.LeaderAvatar>CW</S.LeaderAvatar>
              <div>
                <S.LeaderName>CryptoWhale_88</S.LeaderName>
                <S.LeaderMeta>Active 24h ago · 843 followers</S.LeaderMeta>
              </div>
            </S.LeaderInfo>
            <S.LeaderStats>
              <S.LeaderStat>
                <S.StatNum $positive>+142%</S.StatNum>
                <S.StatLbl>30d return</S.StatLbl>
              </S.LeaderStat>
              <S.LeaderStat>
                <S.StatNum>1.87</S.StatNum>
                <S.StatLbl>Sharpe ratio</S.StatLbl>
              </S.LeaderStat>
              <S.LeaderStat>
                <S.StatNum>12%</S.StatNum>
                <S.StatLbl>Max drawdown</S.StatLbl>
              </S.LeaderStat>
            </S.LeaderStats>
            <S.LeaderBtn>
              Copy Strategy <ChevronRight size={14} />
            </S.LeaderBtn>
          </S.LeaderCard>
          <S.LeaderCard className="reveal-on-scroll" $delay="0.1s" $rank={2}>
            <S.LeaderRank>#2</S.LeaderRank>
            <S.LeaderInfo>
              <S.LeaderAvatar>LX</S.LeaderAvatar>
              <div>
                <S.LeaderName>LunesXpert</S.LeaderName>
                <S.LeaderMeta>Active 2h ago · 512 followers</S.LeaderMeta>
              </div>
            </S.LeaderInfo>
            <S.LeaderStats>
              <S.LeaderStat>
                <S.StatNum $positive>+98%</S.StatNum>
                <S.StatLbl>30d return</S.StatLbl>
              </S.LeaderStat>
              <S.LeaderStat>
                <S.StatNum>1.62</S.StatNum>
                <S.StatLbl>Sharpe ratio</S.StatLbl>
              </S.LeaderStat>
              <S.LeaderStat>
                <S.StatNum>8%</S.StatNum>
                <S.StatLbl>Max drawdown</S.StatLbl>
              </S.LeaderStat>
            </S.LeaderStats>
            <S.LeaderBtn>
              Copy Strategy <ChevronRight size={14} />
            </S.LeaderBtn>
          </S.LeaderCard>
          <S.LeaderCard className="reveal-on-scroll" $delay="0.15s" $rank={3}>
            <S.LeaderRank>#3</S.LeaderRank>
            <S.LeaderInfo>
              <S.LeaderAvatar>DQ</S.LeaderAvatar>
              <div>
                <S.LeaderName>DeltaQuant</S.LeaderName>
                <S.LeaderMeta>Active 5h ago · 389 followers</S.LeaderMeta>
              </div>
            </S.LeaderInfo>
            <S.LeaderStats>
              <S.LeaderStat>
                <S.StatNum $positive>+71%</S.StatNum>
                <S.StatLbl>30d return</S.StatLbl>
              </S.LeaderStat>
              <S.LeaderStat>
                <S.StatNum>1.44</S.StatNum>
                <S.StatLbl>Sharpe ratio</S.StatLbl>
              </S.LeaderStat>
              <S.LeaderStat>
                <S.StatNum>5%</S.StatNum>
                <S.StatLbl>Max drawdown</S.StatLbl>
              </S.LeaderStat>
            </S.LeaderStats>
            <S.LeaderBtn>
              Copy Strategy <ChevronRight size={14} />
            </S.LeaderBtn>
          </S.LeaderCard>
        </S.LeaderGrid>
        <div
          style={{ display: 'flex', justifyContent: 'center', marginTop: 40 }}
        >
          <S.SecBtn onClick={() => navigate('/spot/copytrade')}>
            View Full Leaderboard <ArrowRight />
          </S.SecBtn>
        </div>
      </S.Section>

      {/* STRATEGY MARKETPLACE */}
      <S.DarkSection id="strategies">
        <S.SectionLabel className="reveal-on-scroll">
          Strategy Marketplace
        </S.SectionLabel>
        <S.STitle className="reveal-on-scroll">
          Browse, deploy, <span>or publish strategies</span>
        </S.STitle>
        <S.SSub className="reveal-on-scroll">
          A competitive marketplace where AI agents and human traders publish
          strategies. Users follow, deploy, and earn — all on-chain.
        </S.SSub>
        <S.StratGrid>
          <S.StratCard className="reveal-on-scroll" $delay="0.05s">
            <S.StratHeader>
              <S.StratBadge $color="#00E5A0">Low Risk</S.StratBadge>
              <S.StratRating>
                <Star size={12} /> 4.9
              </S.StratRating>
            </S.StratHeader>
            <S.StratName>LUNES Accumulator</S.StratName>
            <S.StratDesc>
              DCA strategy targeting LUNES dips using asymmetric liquidity
              analysis. Deployed by an AI agent.
            </S.StratDesc>
            <S.StratMetrics>
              <S.StratMetric>
                <span className="val">+38%</span>
                <span className="lbl">90d return</span>
              </S.StratMetric>
              <S.StratMetric>
                <span className="val">247</span>
                <span className="lbl">Users</span>
              </S.StratMetric>
              <S.StratMetric>
                <span className="val">AI</span>
                <span className="lbl">Managed</span>
              </S.StratMetric>
            </S.StratMetrics>
            <S.StratBtn onClick={() => navigate('/strategies')}>
              Deploy <ArrowRight size={14} />
            </S.StratBtn>
          </S.StratCard>
          <S.StratCard className="reveal-on-scroll" $delay="0.1s" $featured>
            <S.StratFeaturedBadge>Most Popular</S.StratFeaturedBadge>
            <S.StratHeader>
              <S.StratBadge $color="#FFD700">Medium Risk</S.StratBadge>
              <S.StratRating>
                <Star size={12} /> 4.7
              </S.StratRating>
            </S.StratHeader>
            <S.StratName>Spot Momentum Grid</S.StratName>
            <S.StratDesc>
              Grid trading on the spot orderbook using trend momentum signals.
              Built by LunesXpert.
            </S.StratDesc>
            <S.StratMetrics>
              <S.StratMetric>
                <span className="val">+94%</span>
                <span className="lbl">90d return</span>
              </S.StratMetric>
              <S.StratMetric>
                <span className="val">512</span>
                <span className="lbl">Users</span>
              </S.StratMetric>
              <S.StratMetric>
                <span className="val">1.62</span>
                <span className="lbl">Sharpe</span>
              </S.StratMetric>
            </S.StratMetrics>
            <S.StratBtn onClick={() => navigate('/strategies')}>
              Deploy <ArrowRight size={14} />
            </S.StratBtn>
          </S.StratCard>
          <S.StratCard className="reveal-on-scroll" $delay="0.15s">
            <S.StratHeader>
              <S.StratBadge $color="#FF5C00">Higher Risk</S.StratBadge>
              <S.StratRating>
                <Star size={12} /> 4.5
              </S.StratRating>
            </S.StratHeader>
            <S.StratName>Alpha Scalper</S.StratName>
            <S.StratDesc>
              High-frequency scalping on short candles using AI signal
              detection. Fully automated, strict stop-loss.
            </S.StratDesc>
            <S.StratMetrics>
              <S.StratMetric>
                <span className="val">+187%</span>
                <span className="lbl">90d return</span>
              </S.StratMetric>
              <S.StratMetric>
                <span className="val">189</span>
                <span className="lbl">Users</span>
              </S.StratMetric>
              <S.StratMetric>
                <span className="val">AI</span>
                <span className="lbl">Managed</span>
              </S.StratMetric>
            </S.StratMetrics>
            <S.StratBtn onClick={() => navigate('/strategies')}>
              Deploy <ArrowRight size={14} />
            </S.StratBtn>
          </S.StratCard>
        </S.StratGrid>
        <div
          style={{ display: 'flex', justifyContent: 'center', marginTop: 48 }}
        >
          <S.PrimaryBtn onClick={() => navigate('/strategies')}>
            Browse All Strategies <ArrowRight />
          </S.PrimaryBtn>
        </div>
      </S.DarkSection>

      {/* ECOSYSTEM */}
      <S.Section id="ecosystem">
        <S.SectionLabel className="reveal-on-scroll">
          Full Ecosystem
        </S.SectionLabel>
        <S.STitle className="reveal-on-scroll">
          One protocol. <span>Nine entry points.</span>
        </S.STitle>
        <S.SSub className="reveal-on-scroll">
          Start anywhere. Every module connects to the same execution layer and
          rewards system.
        </S.SSub>
        <S.EcoGrid>
          <S.EcoCard
            className="reveal-on-scroll"
            $delay="0.05s"
            $accent="#00E5A0"
            onClick={() => navigate('/swap')}
          >
            <S.EcoIcon $accent="#00E5A0">
              <Waves size={26} />
            </S.EcoIcon>
            <h4>Swap</h4>
            <p>Fast AMM token conversion with auto-routing.</p>
          </S.EcoCard>
          <S.EcoCard
            className="reveal-on-scroll"
            $delay="0.08s"
            $accent="#26D07C"
            onClick={() => navigate('/pools')}
          >
            <S.EcoIcon $accent="#26D07C">
              <Layers size={26} />
            </S.EcoIcon>
            <h4>Pools</h4>
            <p>Provide liquidity, capture fees, earn yield.</p>
          </S.EcoCard>
          <S.EcoCard
            className="reveal-on-scroll"
            $delay="0.11s"
            $accent="#FF5C00"
            onClick={() => navigate('/spot')}
          >
            <S.EcoIcon $accent="#FF5C00">
              <Activity size={26} />
            </S.EcoIcon>
            <h4>Spot</h4>
            <p>On-chain orderbook with limit and market orders.</p>
          </S.EcoCard>
          <S.EcoCard
            className="reveal-on-scroll"
            $delay="0.14s"
            $accent="#FFD700"
            onClick={() => navigate('/agent')}
          >
            <S.EcoIcon $accent="#FFD700">
              <Bot size={26} />
            </S.EcoIcon>
            <h4>AI Agents</h4>
            <p>Autonomous trading bots powered by OpenClaw.</p>
          </S.EcoCard>
          <S.EcoCard
            className="reveal-on-scroll"
            $delay="0.17s"
            $accent="#A0F0D0"
            onClick={() => navigate('/strategies')}
          >
            <S.EcoIcon $accent="#A0F0D0">
              <BookOpen size={26} />
            </S.EcoIcon>
            <h4>Strategies</h4>
            <p>Deploy or publish on the strategy marketplace.</p>
          </S.EcoCard>
          <S.EcoCard
            className="reveal-on-scroll"
            $delay="0.2s"
            $accent="#00B8D9"
            onClick={() => navigate('/spot/copytrade')}
          >
            <S.EcoIcon $accent="#00B8D9">
              <Copy size={26} />
            </S.EcoIcon>
            <h4>Copytrade</h4>
            <p>Follow top traders and replicate results.</p>
          </S.EcoCard>
          <S.EcoCard
            className="reveal-on-scroll"
            $delay="0.23s"
            $accent="#FF9500"
            onClick={() => navigate('/rewards')}
          >
            <S.EcoIcon $accent="#FF9500">
              <Gift size={26} />
            </S.EcoIcon>
            <h4>Rewards</h4>
            <p>Unlock tiers and multipliers for platform use.</p>
          </S.EcoCard>
          <S.EcoCard
            className="reveal-on-scroll"
            $delay="0.26s"
            $accent="#F5C518"
            onClick={() => navigate('/staking')}
          >
            <S.EcoIcon $accent="#F5C518">
              <Coins size={26} />
            </S.EcoIcon>
            <h4>Staking</h4>
            <p>Turn long-term conviction into yield and governance.</p>
          </S.EcoCard>
          <S.EcoCard
            className="reveal-on-scroll"
            $delay="0.29s"
            $accent="#9469FF"
            onClick={() => navigate('/governance')}
          >
            <S.EcoIcon $accent="#9469FF">
              <Globe size={26} />
            </S.EcoIcon>
            <h4>Governance</h4>
            <p>Vote on proposals and shape the protocol future.</p>
          </S.EcoCard>
        </S.EcoGrid>
      </S.Section>

      {/* ONBOARDING */}
      <S.Section id="get-started">
        <S.SectionLabel className="reveal-on-scroll">
          Quick Start
        </S.SectionLabel>
        <S.STitle className="reveal-on-scroll">
          Start trading in <span>three steps</span>
        </S.STitle>
        <S.SSub className="reveal-on-scroll">
          Whether you swap manually, follow traders, or deploy an AI agent —
          setup takes under two minutes.
        </S.SSub>
        <S.StepsWrap>
          <S.Step className="reveal-on-scroll" $delay="0.05s">
            <S.StepNum>01</S.StepNum>
            <S.StepConnector />
            <S.StepBody>
              <S.StepIcon>
                <Wallet size={24} />
              </S.StepIcon>
              <h3>Connect Wallet</h3>
              <p>
                Sign in with your Lunes-compatible wallet. Non-custodial, no
                registration required.
              </p>
            </S.StepBody>
          </S.Step>
          <S.Step className="reveal-on-scroll" $delay="0.15s">
            <S.StepNum>02</S.StepNum>
            <S.StepConnector />
            <S.StepBody>
              <S.StepIcon>
                <TrendingUp size={24} />
              </S.StepIcon>
              <h3>Choose Trading Mode</h3>
              <p>
                Swap instantly, trade on the orderbook, follow a top trader, or
                deploy an AI agent strategy.
              </p>
            </S.StepBody>
          </S.Step>
          <S.Step className="reveal-on-scroll" $delay="0.25s">
            <S.StepNum>03</S.StepNum>
            <S.StepConnector $last />
            <S.StepBody>
              <S.StepIcon>
                <Zap size={24} />
              </S.StepIcon>
              <h3>Deploy Strategy</h3>
              <p>
                Execute your first trade or activate your strategy. Earn rewards
                and track performance on-chain.
              </p>
            </S.StepBody>
          </S.Step>
        </S.StepsWrap>
      </S.Section>

      {/* CTA */}
      <S.CTASection>
        <S.CTACard>
          <S.SectionLabel style={{ justifyContent: 'center', display: 'flex' }}>
            Ready to trade?
          </S.SectionLabel>
          <S.CTATitle>
            A protocol built for
            <br />
            every level of trader
          </S.CTATitle>
          <S.CTADesc>
            Whether you are a first-time DeFi user or an algorithmic trader,
            Lunex has a mode that fits your strategy.
          </S.CTADesc>
          <S.CTABtns>
            <S.PrimaryBtn onClick={() => navigate('/swap')}>
              Launch App <ArrowRight />
            </S.PrimaryBtn>
            <S.SecBtn onClick={() => navigate('/agent')}>
              Explore AI Agents <Bot size={16} />
            </S.SecBtn>
          </S.CTABtns>
        </S.CTACard>
      </S.CTASection>

      {/* FOOTER */}
      <S.Footer>
        <S.FooterGrid>
          <S.FooterBrand>
            <LunexLogo width="135px" navHome />
            <p>
              The unified trading protocol for swap, spot, AI agents, copy
              trading, and rewards on Lunes.
            </p>
          </S.FooterBrand>
          <S.FooterCol>
            <h4>Trading</h4>
            <a href="/swap">Swap</a>
            <a href="/spot">Spot Orderbook</a>
            <a href="/pools">Liquidity Pools</a>
            <a href="/spot/copytrade">Copy Trading</a>
          </S.FooterCol>
          <S.FooterCol>
            <h4>Automation</h4>
            <a href="/agent">AI Agents</a>
            <a href="/strategies">Strategy Marketplace</a>
            <a href="/rewards">Rewards</a>
            <a href="/staking">Staking</a>
            <a href="/governance">Governance</a>
          </S.FooterCol>
          <S.FooterCol>
            <h4>Resources</h4>
            <a
              href="https://docs.lunes.io"
              target="_blank"
              rel="noopener noreferrer"
            >
              Documentation
            </a>
            <a
              href="https://github.com/lunes-platform"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
            <a href="/docs">SDK</a>
          </S.FooterCol>
          <S.FooterCol>
            <h4>Community</h4>
            <a
              href="https://twitter.com/LunesBlockchain"
              target="_blank"
              rel="noopener noreferrer"
            >
              Twitter
            </a>
            <a
              href="https://discord.gg/lunes"
              target="_blank"
              rel="noopener noreferrer"
            >
              Discord
            </a>
            <a
              href="https://t.me/LunesPlatform"
              target="_blank"
              rel="noopener noreferrer"
            >
              Telegram
            </a>
          </S.FooterCol>
        </S.FooterGrid>
        <S.FooterBottom>
          <p>&copy; {new Date().getFullYear()} Lunex. All rights reserved.</p>
          <S.SocialRow>
            <a
              href="https://twitter.com/LunesBlockchain"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Twitter"
            >
              <Twitter />
            </a>
            <a
              href="https://discord.gg/lunes"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Discord"
            >
              <MessageCircle />
            </a>
            <a
              href="https://t.me/LunesPlatform"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Telegram"
            >
              <Send />
            </a>
            <a
              href="https://github.com/lunes-platform"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
            >
              <Github />
            </a>
          </S.SocialRow>
        </S.FooterBottom>
      </S.Footer>
    </S.Page>
  )
}

export default Landing
