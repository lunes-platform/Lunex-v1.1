import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { ArrowDown, ArrowRight } from 'lucide-react'
import { useWebMCP } from '../../hooks/useWebMCP'
import { CountUp } from './CountUp'
import { HowItWorks } from './HowItWorks'
import { Starfield } from './Starfield'
import {
  BENEFITS,
  chgColor,
  ECO_ORBITS,
  fmtChg,
  fmtPrice,
  HERO_ORBITS,
  MODES,
  NO_DATA,
  STAT_DEFS
} from './data'
import { useLandingMarket } from './useLandingMarket'
import * as S from './styles'
import { NETWORK } from '../../config/contracts'

const IS_TESTNET = NETWORK.name !== 'mainnet'

const prefersReduced = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const isWide = () => typeof window !== 'undefined' && window.innerWidth >= 860

const REVEAL_MS = 850

/**
 * Scroll / mouse driven motion for the whole page, applied straight to the
 * DOM (no React re-render per frame):
 * - nav turns translucent after 30px of scroll
 * - `[data-speed]` vertical parallax, `[data-mouse]` 3D tilt
 * - `[data-reveal]` rise-in on enter (`data-delay` staggers)
 */
const useLandingMotion = (
  rootRef: React.RefObject<HTMLDivElement>,
  navRef: React.RefObject<HTMLElement>,
  mouse: React.MutableRefObject<{ x: number; y: number }>,
  reduced: boolean
) => {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const timers: number[] = []
    let raf = 0

    const frame = () => {
      raf = 0
      const y = window.scrollY || 0
      const vh = window.innerHeight
      navRef.current?.setAttribute('data-scrolled', String(y > 30))
      if (reduced) return
      root.querySelectorAll<HTMLElement>('[data-speed]').forEach(el => {
        const sp = parseFloat(el.dataset.speed || '0')
        // Measure without our own transform so the offset does not feed back.
        const r = el.getBoundingClientRect()
        const prev = parseFloat(el.dataset.py || '0')
        const c = r.top - prev + r.height / 2 - vh / 2
        const py = c * sp * -0.4
        el.dataset.py = py.toFixed(1)
        el.style.transform =
          (el.dataset.center !== undefined ? 'translateX(-50%) ' : '') +
          `translate3d(0,${py.toFixed(1)}px,0)`
      })
      const { x: mx, y: my } = mouse.current
      root.querySelectorAll<HTMLElement>('[data-mouse]').forEach(el => {
        const f = parseFloat(el.dataset.mouse || '0')
        el.style.transform =
          `translate3d(${(mx * f).toFixed(1)}px,${(my * f).toFixed(1)}px,0) ` +
          `rotateX(${(-my * 6).toFixed(2)}deg) rotateY(${(mx * 6).toFixed(2)}deg)`
      })
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(frame)
    }
    const onMouse = (e: MouseEvent) => {
      mouse.current = {
        x: e.clientX / window.innerWidth - 0.5,
        y: e.clientY / window.innerHeight - 0.5
      }
      schedule()
    }

    // Reveal: only elements below the fold start hidden.
    let io: IntersectionObserver | null = null
    if (!reduced && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(
        entries =>
          entries.forEach(en => {
            if (!en.isIntersecting) return
            const el = en.target as HTMLElement
            io?.unobserve(el)
            const d = Number(el.dataset.delay || 0)
            timers.push(
              window.setTimeout(() => {
                el.dataset.rv = 'in'
                timers.push(
                  window.setTimeout(() => {
                    el.dataset.rv = 'done'
                  }, REVEAL_MS)
                )
              }, d)
            )
          }),
        { threshold: 0.15 }
      )
      root.querySelectorAll<HTMLElement>('[data-reveal]').forEach(el => {
        if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return
        el.dataset.rv = 'pending'
        io?.observe(el)
      })
    }

    frame()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    if (!reduced) {
      window.addEventListener('mousemove', onMouse, { passive: true })
    }
    return () => {
      cancelAnimationFrame(raf)
      timers.forEach(t => clearTimeout(t))
      io?.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('mousemove', onMouse)
    }
  }, [rootRef, navRef, mouse, reduced])
}

const ArrowIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <ArrowRight size={size} strokeWidth={2} aria-hidden="true" />
)

const Paths: React.FC<{ paths: string[]; size: number; stroke: number }> = ({
  paths,
  size,
  stroke
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {paths.map(d => (
      <path key={d} d={d} />
    ))}
  </svg>
)

export const Landing: React.FC = () => {
  const rootRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const howRef = useRef<HTMLElement>(null)
  const benRef = useRef<HTMLElement>(null)
  const ecoRef = useRef<HTMLElement>(null)
  const mouse = useRef({ x: 0, y: 0 })
  const [reduced, setReduced] = useState(prefersReduced)
  const [wide, setWide] = useState(isWide)

  // Initialize WebMCP for AI agent interaction
  useWebMCP()

  // Live prices / TVL / volume (no fictional figures — "—" when unavailable)
  const { tokens: liveTokens, stats } = useLandingMarket()

  // Capture referral code from URL
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref')
    if (ref && ref.length >= 4) {
      try {
        localStorage.setItem('lunex_referral_code', ref)
      } catch {
        /* storage unavailable */
      }
    }
  }, [])

  useEffect(() => {
    const onResize = () => setWide(isWide())
    window.addEventListener('resize', onResize, { passive: true })
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const onMq = () => setReduced(!!mq?.matches)
    mq?.addEventListener?.('change', onMq)
    return () => {
      window.removeEventListener('resize', onResize)
      mq?.removeEventListener?.('change', onMq)
    }
  }, [])

  useLandingMotion(rootRef, navRef, mouse, reduced)

  const scrollTo = useCallback(
    (top: number) =>
      window.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' }),
    [reduced]
  )
  const scrollToRef = (ref: React.RefObject<HTMLElement>) => {
    const el = ref.current
    if (el) scrollTo(el.getBoundingClientRect().top + window.scrollY - 72)
  }

  const navLinks: [string, React.RefObject<HTMLElement>][] = [
    ['How it works', howRef],
    ['Benefits', benRef],
    ['Ecosystem', ecoRef]
  ]

  return (
    <S.Root ref={rootRef}>
      <Helmet>
        <title>Lunex — Trade across the Lunes universe</title>
        <meta
          name="description"
          content="Swap, provide liquidity, stake, trade the orderbook or let AI agents work for you. One non-custodial protocol on the Lunes blockchain, every fee visible before you sign."
        />
      </Helmet>

      <Starfield mouse={mouse} reduced={reduced} />

      <S.Nav ref={navRef} data-scrolled="false">
        <S.LogoLink to="/" aria-label="Lunex home">
          <img src="/img/lunes-logo.svg" alt="Lunex" />
        </S.LogoLink>
        {wide && (
          <S.NavLinks>
            {navLinks.map(([label, ref]) => (
              <S.NavLink
                key={label}
                type="button"
                onClick={() => scrollToRef(ref)}
              >
                {label}
              </S.NavLink>
            ))}
          </S.NavLinks>
        )}
        <S.NavCta to="/swap">
          Launch app
          <ArrowIcon size={16} />
        </S.NavCta>
      </S.Nav>

      {/* HERO */}
      <S.Hero>
        <S.Nebula $variant="violet" data-speed="0.35" />
        <S.Nebula $variant="green" data-speed="0.2" />
        <S.HeroInner>
          <S.HeroCopy data-speed="-0.12">
            <S.H1>
              Trade across the <S.Gradient>Lunes universe</S.Gradient>
            </S.H1>
            <S.HeroLead>
              Swap, provide liquidity, stake, trade the orderbook or let AI
              agents work for you. One non-custodial protocol, every fee visible
              before you sign.
            </S.HeroLead>
            <S.Ctas>
              <S.PrimaryCta to="/swap">
                <S.Sweep aria-hidden="true" />
                Launch app
                <ArrowIcon />
              </S.PrimaryCta>
              <S.GhostCta type="button" onClick={() => scrollToRef(howRef)}>
                See how it works
                <ArrowDown size={18} strokeWidth={2} aria-hidden="true" />
              </S.GhostCta>
            </S.Ctas>
          </S.HeroCopy>
          <S.HeroArt data-speed="0.08">
            <S.OrbitStage data-mouse="18" aria-hidden="true">
              <S.RingLine
                $inset="0"
                $border="1px solid rgba(255,255,255,0.07)"
              />
              <S.RingLine
                $inset="14%"
                $border="1px dashed rgba(173,135,255,0.18)"
              />
              <S.RingLine
                $inset="30%"
                $border="1px solid rgba(255,255,255,0.06)"
              />
              {HERO_ORBITS.map(o => (
                <S.OrbitTrack
                  key={o.sym}
                  $inset={o.inset}
                  $dur={o.dur}
                  $delay={o.delay}
                >
                  <S.OrbitAnchor>
                    <S.OrbitBody
                      $dur={o.dur}
                      $delay={o.delay}
                      $size={o.size}
                      $glow={o.glow}
                    >
                      <img src={o.icon} alt={o.sym} />
                    </S.OrbitBody>
                  </S.OrbitAnchor>
                </S.OrbitTrack>
              ))}
              <S.Core>
                <S.Pulse />
                <S.Pulse $delay="1.5s" />
                <S.Planet>
                  <img src="/img/lunes.svg" alt="" />
                </S.Planet>
              </S.Core>
            </S.OrbitStage>
          </S.HeroArt>
        </S.HeroInner>

        {/* Live spot tickers ("—" when there is no market yet) */}
        <S.Marquee aria-label="Token prices">
          <S.MarqueeTrack>
            {liveTokens.concat(liveTokens).map((t, i) => (
              <S.Tick key={`${t.sym}-${i}`} aria-hidden={i >= liveTokens.length}>
                <img src={t.icon} alt="" />
                <S.TickPair>
                  {t.sym}
                  {t.sym === 'LUSDT' ? '' : '/LUSDT'}
                </S.TickPair>
                <span style={{ color: '#D0D0D3' }}>{fmtPrice(t.price)}</span>
                <span style={{ color: chgColor(t.chg), fontWeight: 600 }}>
                  {fmtChg(t.chg)}
                </span>
              </S.Tick>
            ))}
          </S.MarqueeTrack>
        </S.Marquee>
      </S.Hero>

      {/* STATS — live (on-chain reserves + spot tickers); "—" = no data */}
      <S.Section $pad="80px clamp(16px, 5vw, 72px) 40px">
        <S.StatsBand data-reveal="">
          {STAT_DEFS.map(st => (
            <S.StatCell key={st.label} data-stat={st.key}>
              <S.StatLabel>{st.label}</S.StatLabel>
              <S.StatValue>
                {stats[st.key] == null ? (
                  NO_DATA
                ) : (
                  <CountUp
                    value={stats[st.key] as number}
                    fmt={st.fmt}
                    reduced={reduced}
                  />
                )}
              </S.StatValue>
              <span style={{ fontSize: 12, color: st.subColor }}>
                {st.sub}
                {IS_TESTNET && (st.key === 'tvl' || st.key === 'volume24h')
                  ? ' · testnet tokens, no real value'
                  : ''}
              </span>
            </S.StatCell>
          ))}
        </S.StatsBand>
      </S.Section>

      <HowItWorks
        ref={howRef}
        wide={wide}
        reduced={reduced}
        scrollTo={scrollTo}
      />

      {/* BENEFITS */}
      <S.Section ref={benRef}>
        <S.BenefitPlanet data-speed="0.25" />
        <S.Stack>
          <S.SectionHead data-reveal="">
            <S.Kicker>Why Lunex</S.Kicker>
            <S.H2>Built so every participant gets paid</S.H2>
          </S.SectionHead>
          <S.CardGrid $min={280}>
            {BENEFITS.map((b, i) => (
              <S.BenefitCard key={b.title} data-reveal="" data-delay={i * 90}>
                <S.CardGlow $color={b.glow} $delay={i * 90} />
                <S.BenefitIcon $color={b.color}>
                  <Paths paths={b.paths} size={24} stroke={1.6} />
                </S.BenefitIcon>
                <S.BigRow>
                  <S.Big $color={b.color}>{b.big}</S.Big>
                  <S.BigSub>{b.bigSub}</S.BigSub>
                </S.BigRow>
                <S.CardTitle>{b.title}</S.CardTitle>
                <S.CardBody>{b.body}</S.CardBody>
              </S.BenefitCard>
            ))}
          </S.CardGrid>
        </S.Stack>
      </S.Section>

      {/* MODES */}
      <S.Section $pad="80px clamp(16px, 5vw, 72px) 100px">
        <S.Stack>
          <S.SectionHead data-reveal="">
            <S.Kicker>Multi-layer trading</S.Kicker>
            <S.H2>Choose your trajectory</S.H2>
          </S.SectionHead>
          <S.CardGrid $min={260}>
            {MODES.map((m, i) => (
              <div key={m.kicker} data-speed={m.speed}>
                <S.ModeCard
                  to={m.to}
                  $color={m.color}
                  data-reveal=""
                  data-delay={i * 110}
                >
                  <S.ModeArt aria-hidden="true">
                    <S.ModeRing $ring={m.ring}>
                      <S.ModeMoon $color={m.color} />
                    </S.ModeRing>
                    <S.ModeIcon $color={m.color} $tint={m.tint} $ring={m.ring}>
                      <Paths paths={m.paths} size={22} stroke={1.75} />
                    </S.ModeIcon>
                  </S.ModeArt>
                  <S.ModeKicker $color={m.color}>{m.kicker}</S.ModeKicker>
                  <S.ModeTitle>{m.title}</S.ModeTitle>
                  <S.ModeBody>{m.body}</S.ModeBody>
                  <S.ModeOpen>
                    Open
                    <ArrowIcon size={14} />
                  </S.ModeOpen>
                </S.ModeCard>
              </div>
            ))}
          </S.CardGrid>
        </S.Stack>
      </S.Section>

      {/* ECOSYSTEM */}
      <S.Section ref={ecoRef}>
        <S.EcoLayout>
          <S.EcoCopy>
            <S.SectionHead data-reveal="">
              <S.Kicker>Ecosystem</S.Kicker>
              <S.H2>One liquidity layer. Every Lunes asset.</S.H2>
              <S.Lead>
                Bridged Bitcoin and Ethereum, stablecoins and ecosystem tokens
                share the same pools, orderbook and rewards system.
              </S.Lead>
            </S.SectionHead>
            {/* Live spot tickers ("—" when there is no market yet) */}
            <S.TokenList>
              {liveTokens.map((t, i) => (
                <S.TokenRow key={t.sym} data-reveal="" data-delay={i * 70}>
                  <img src={t.icon} alt="" />
                  <S.TokenName>
                    <b>{t.sym}</b>
                    <small>{t.name}</small>
                  </S.TokenName>
                  <S.TokenPrice>{fmtPrice(t.price)}</S.TokenPrice>
                  <S.TokenChg $color={chgColor(t.chg)}>
                    {fmtChg(t.chg)}
                  </S.TokenChg>
                </S.TokenRow>
              ))}
            </S.TokenList>
          </S.EcoCopy>
          <S.EcoArt>
            <S.EcoStage data-speed="-0.1" aria-hidden="true">
              <S.EcoPlanet />
              <S.EcoBands />
              <S.EcoRing />
              {ECO_ORBITS.map(o => (
                <S.OrbitTrack
                  key={o.sym}
                  $inset={o.inset}
                  $dur={o.dur}
                  $delay={o.delay}
                >
                  <S.OrbitAnchor>
                    <S.OrbitBody
                      $dur={o.dur}
                      $delay={o.delay}
                      $size="44px"
                      $border="rgba(255,255,255,0.14)"
                    >
                      <img
                        src={o.icon}
                        alt=""
                        style={{ width: 30, height: 30 }}
                      />
                    </S.OrbitBody>
                  </S.OrbitAnchor>
                </S.OrbitTrack>
              ))}
            </S.EcoStage>
          </S.EcoArt>
        </S.EcoLayout>
      </S.Section>

      {/* CTA */}
      <S.CtaSection>
        <S.CtaInner data-reveal="">
          <S.CtaTitle>Ready for launch?</S.CtaTitle>
          <S.CtaLead>
            Connect a wallet and make your first swap in under two minutes. No
            sign-up, no custody.
          </S.CtaLead>
          <S.CtaButton to="/swap">
            Launch app
            <ArrowIcon />
          </S.CtaButton>
        </S.CtaInner>
        <S.Horizon data-speed="0.15" data-center="" />
      </S.CtaSection>

      <S.Footer>
        <S.FooterInner>
          <S.FooterBrand>
            <img src="/img/lunes-logo.svg" alt="Lunex" />
            <span>The unified trading protocol on Lunes.</span>
          </S.FooterBrand>
          <S.FooterLinks>
            <Link to="/swap">App</Link>
            <Link to="/docs">Docs</Link>
            <Link to="/pools">Pools</Link>
            <Link to="/staking">Staking</Link>
            <Link to="/governance">Governance</Link>
            <Link to="/protocol-stats">Revenue</Link>
          </S.FooterLinks>
        </S.FooterInner>
      </S.Footer>
    </S.Root>
  )
}

export default Landing
