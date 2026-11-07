import React, {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'
import { FLOWS, STEPS, STEP_CAPTIONS } from './data'
import * as S from './styles'

type Props = {
  wide: boolean
  reduced: boolean
  scrollTo: (top: number) => void
}

const lit = (on: boolean) => (on ? 1 : 0.28)

/**
 * Sticky protocol diagram synced to 4 scroll steps
 * (Connect → Swap → Fee split → Stake & earn).
 */
export const HowItWorks = forwardRef<HTMLElement, Props>(
  ({ wide, reduced, scrollTo }, ref) => {
    const [step, setStep] = useState(1)
    const stepsRef = useRef<HTMLDivElement>(null)
    const stepRef = useRef(1)

    useEffect(() => {
      let raf = 0
      const measure = () => {
        raf = 0
        const col = stepsRef.current
        if (!col) return
        const vh = window.innerHeight
        // On narrow screens the sticky diagram covers the top half.
        const focus = vh * (wide ? 0.5 : 0.72)
        let best = stepRef.current
        let bd = Infinity
        col.querySelectorAll<HTMLElement>('[data-step]').forEach(el => {
          const r = el.getBoundingClientRect()
          const d = Math.abs(r.top + r.height / 2 - focus)
          if (d < bd) {
            bd = d
            best = Number(el.dataset.step)
          }
        })
        if (best !== stepRef.current) {
          stepRef.current = best
          setStep(best)
        }
      }
      const onScroll = () => {
        if (!raf) raf = requestAnimationFrame(measure)
      }
      measure()
      window.addEventListener('scroll', onScroll, { passive: true })
      window.addEventListener('resize', onScroll, { passive: true })
      return () => {
        cancelAnimationFrame(raf)
        window.removeEventListener('scroll', onScroll)
        window.removeEventListener('resize', onScroll)
      }
    }, [wide])

    const goStep = useCallback(
      (i: number) => {
        const el = stepsRef.current?.querySelector<HTMLElement>(
          `[data-step="${i}"]`
        )
        if (!el) return
        const focus = window.innerHeight * (wide ? 0.5 : 0.72)
        scrollTo(
          el.getBoundingClientRect().top +
            window.scrollY -
            focus +
            el.offsetHeight / 2
        )
      },
      [scrollTo, wide]
    )

    const nd = {
      wallet: lit(step === 1 || step === 4),
      pool: lit(step === 2 || step === 3),
      lp: lit(step === 3),
      proto: lit(step === 3),
      stake: lit(step >= 3)
    }

    return (
      <S.Section ref={ref} $pad="100px clamp(16px, 5vw, 72px) 60px">
        <S.Inner>
          <S.SectionHead data-reveal="" $mb={40}>
            <S.Kicker>How the protocol works</S.Kicker>
            <S.H2>From your wallet to rewards, in one orbit</S.H2>
          </S.SectionHead>
          <S.HowLayout>
            <S.DiagramSticky $wide={wide}>
              <S.DiagramCard $wide={wide}>
                <svg
                  viewBox="0 0 400 400"
                  role="img"
                  aria-label={`Protocol diagram, ${STEP_CAPTIONS[step].toLowerCase()}`}
                >
                  <defs>
                    <radialGradient id="lunexPoolG" cx="40%" cy="35%">
                      <stop offset="0%" stopColor="#9469FF" />
                      <stop offset="100%" stopColor="#291193" />
                    </radialGradient>
                  </defs>
                  {FLOWS.map(f => (
                    <g key={f.d}>
                      <path
                        d={f.d}
                        fill="none"
                        stroke="#24232B"
                        strokeWidth={3}
                        strokeLinecap="round"
                      />
                      <S.Flow
                        d={f.d}
                        fill="none"
                        stroke={f.color}
                        strokeWidth={3}
                        strokeLinecap="round"
                        strokeDasharray="8 12"
                        opacity={step >= f.from ? 1 : 0}
                      />
                    </g>
                  ))}
                  {!reduced &&
                    FLOWS.map((f, i) => (
                      <circle
                        key={`p-${f.d}`}
                        r={5}
                        fill={f.color}
                        opacity={step >= f.from ? 1 : 0}
                        style={{
                          filter: `drop-shadow(0 0 6px ${f.color})`,
                          transition: 'opacity .4s'
                        }}
                      >
                        <animateMotion
                          dur={`${1.6 + i * 0.2}s`}
                          repeatCount="indefinite"
                          path={f.d}
                          begin={`${i * 0.3}s`}
                        />
                      </circle>
                    ))}
                  <S.Node opacity={nd.wallet}>
                    <rect
                      x={34}
                      y={46}
                      width={88}
                      height={62}
                      rx={16}
                      fill="#16151C"
                      stroke="#6C38FF"
                      strokeWidth={1.5}
                    />
                    <image
                      href="/img/lunes-wallet.svg"
                      x={62}
                      y={56}
                      width={32}
                      height={32}
                    />
                    <text
                      x={78}
                      y={101}
                      textAnchor="middle"
                      fill="#D0D0D3"
                      fontSize={11}
                      fontFamily="Inter"
                    >
                      Your wallet
                    </text>
                  </S.Node>
                  <S.Node opacity={nd.pool}>
                    <circle
                      cx={200}
                      cy={186}
                      r={50}
                      fill="url(#lunexPoolG)"
                      stroke="#AD87FF"
                      strokeWidth={1.5}
                    />
                    <image
                      href="/img/lunes-green.svg"
                      x={168}
                      y={164}
                      width={30}
                      height={30}
                    />
                    <image
                      href="/img/lusdt.png"
                      x={200}
                      y={164}
                      width={30}
                      height={30}
                    />
                    <text
                      x={200}
                      y={215}
                      textAnchor="middle"
                      fill="#FFFFFF"
                      fontSize={12}
                      fontWeight={600}
                      fontFamily="Space Grotesk"
                    >
                      Liquidity pool
                    </text>
                  </S.Node>
                  <FeeNode
                    x={44}
                    y={300}
                    stroke="#26D07C"
                    valueColor="#57E290"
                    value="0.3%"
                    label="Liquidity providers"
                    opacity={nd.lp}
                  />
                  <FeeNode
                    x={152}
                    y={308}
                    stroke="#6C38FF"
                    valueColor="#CAAFFF"
                    value="0.1%"
                    label="Protocol"
                    opacity={nd.proto}
                  />
                  <FeeNode
                    x={260}
                    y={300}
                    stroke="#AD87FF"
                    valueColor="#CAAFFF"
                    value="0.1%"
                    label="LUNES stakers"
                    opacity={nd.stake}
                  />
                  <text
                    x={200}
                    y={28}
                    textAnchor="middle"
                    fill="#8A8A8E"
                    fontSize={11}
                    fontFamily="Inter"
                    letterSpacing={1.5}
                  >
                    {STEP_CAPTIONS[step]}
                  </text>
                </svg>
                <S.Dots>
                  {[1, 2, 3, 4].map(i => (
                    <S.Dot
                      key={i}
                      type="button"
                      $on={i <= step}
                      aria-label={`Step ${i}`}
                      aria-current={i === step ? 'step' : undefined}
                      onClick={() => goStep(i)}
                    />
                  ))}
                </S.Dots>
              </S.DiagramCard>
            </S.DiagramSticky>
            <S.StepsCol ref={stepsRef}>
              {STEPS.map((s, i) => {
                const on = step === i + 1
                return (
                  <S.Step
                    key={s.kicker}
                    data-step={i + 1}
                    $on={on}
                    $wide={wide}
                  >
                    <S.StepHead>
                      <S.StepBadge $on={on}>{i + 1}</S.StepBadge>
                      <S.StepKicker>{s.kicker}</S.StepKicker>
                    </S.StepHead>
                    <S.StepTitle>{s.title}</S.StepTitle>
                    <S.StepBody>{s.body}</S.StepBody>
                  </S.Step>
                )
              })}
            </S.StepsCol>
          </S.HowLayout>
        </S.Inner>
      </S.Section>
    )
  }
)
HowItWorks.displayName = 'HowItWorks'

type FeeNodeProps = {
  x: number
  y: number
  stroke: string
  valueColor: string
  value: string
  label: string
  opacity: number
}

const FeeNode: React.FC<FeeNodeProps> = ({
  x,
  y,
  stroke,
  valueColor,
  value,
  label,
  opacity
}) => (
  <S.Node opacity={opacity}>
    <rect
      x={x}
      y={y}
      width={96}
      height={56}
      rx={14}
      fill="#16151C"
      stroke={stroke}
      strokeWidth={1.5}
    />
    <text
      x={x + 48}
      y={y + 24}
      textAnchor="middle"
      fill={valueColor}
      fontSize={17}
      fontWeight={700}
      fontFamily="Space Grotesk"
    >
      {value}
    </text>
    <text
      x={x + 48}
      y={y + 43}
      textAnchor="middle"
      fill="#B6B6B6"
      fontSize={10.5}
      fontFamily="Inter"
    >
      {label}
    </text>
  </S.Node>
)
