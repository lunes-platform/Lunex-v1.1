import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import {
  Zap, Shield, Wallet, Waves, Gift, Users, ArrowRight, ExternalLink,
  Github, Twitter, MessageCircle, Send, Check, X, ArrowDown,
  BarChart3, Layers, Coins, Globe, Droplet, TrendingUp, Shuffle
} from 'lucide-react'
import * as S from './styles'

// Animated counter
const Counter: React.FC<{ end: number; suffix?: string; prefix?: string }> = ({ end, suffix = '', prefix = '' }) => {
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
  return <>{prefix}{val.toLocaleString()}{suffix}</>
}

export const Landing: React.FC = () => {
  const navigate = useNavigate()
  const [scrolled, setScrolled] = useState(false)

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

    // Setup Intersection Observer for Scroll Reveals
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view')
          observer.unobserve(entry.target)
        }
      })
    }, { threshold: 0.15, rootMargin: '0px 0px -50px 0px' })

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
        <title>Lunex — Trade, earn, and stay in control on Lunes</title>
        <meta name="description" content="Trade faster on Lunes with non-custodial execution, low fees, liquidity opportunities, staking rewards, and governance access in one ecosystem." />
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </Helmet>

      {/* NAV */}
      <S.Nav $scrolled={scrolled}>
        <S.Logo>
          <img src="/img/lunes-logo.svg" alt="Lunex" />
        </S.Logo>
        <S.NavLinks>
          <S.NavLink href="#features">Why Lunex</S.NavLink>
          <S.NavLink href="#highlights">Proof</S.NavLink>
          <S.NavLink href="#ecosystem">Ecosystem</S.NavLink>
          <S.NavLink href="https://docs.lunes.io" target="_blank" rel="noopener noreferrer">Docs</S.NavLink>
        </S.NavLinks>
        <S.ConnectBtn onClick={() => navigate('/swap')}>Launch App</S.ConnectBtn>
      </S.Nav>

      {/* HERO */}
      <S.HeroSection>
        <S.HeroGrid>
          <S.HeroContent>
            <S.HeroBadge $delay="0s">
              <Zap size={12} /> Live on Lunes Blockchain
            </S.HeroBadge>
            <S.HeroTitle $delay="0.1s">
              Trade faster.<br />Earn more.<br /><span>Keep control.</span>
            </S.HeroTitle>
            <S.HeroSub $delay="0.2s">
              Lunex brings swap, liquidity, staking, rewards, and governance into one execution layer on Lunes. Built for users who want speed, clarity, and ownership without sacrificing opportunity.
            </S.HeroSub>
            <S.HeroBtns $delay="0.3s">
              <S.PrimaryBtn onClick={() => navigate('/swap')}>
                Launch Swap <ArrowRight />
              </S.PrimaryBtn>
              <S.SecBtn onClick={() => window.open('https://docs.lunes.io', '_blank')}>
                Explore Docs <ExternalLink />
              </S.SecBtn>
            </S.HeroBtns>
            <S.HeroMetricRow $delay="0.32s">
              <S.HeroMetricCard>
                <S.HeroMetricValue>&lt;3s</S.HeroMetricValue>
                <S.HeroMetricLabel>Execution experience</S.HeroMetricLabel>
              </S.HeroMetricCard>
              <S.HeroMetricCard>
                <S.HeroMetricValue>0.5%</S.HeroMetricValue>
                <S.HeroMetricLabel>Flat trading fee</S.HeroMetricLabel>
              </S.HeroMetricCard>
              <S.HeroMetricCard>
                <S.HeroMetricValue>24/7</S.HeroMetricValue>
                <S.HeroMetricLabel>Access to the ecosystem</S.HeroMetricLabel>
              </S.HeroMetricCard>
            </S.HeroMetricRow>
            <S.HeroProofGrid $delay="0.35s">
              <S.HeroProofCard>
                <S.HeroProofIcon>
                  <Wallet />
                </S.HeroProofIcon>
                <S.HeroProofContent>
                  <S.HeroProofTitle>0.5% flat trading fee</S.HeroProofTitle>
                  <S.HeroProofNote>Keep more from every swap and every liquidity move.</S.HeroProofNote>
                </S.HeroProofContent>
              </S.HeroProofCard>
              <S.HeroProofCard>
                <S.HeroProofIcon>
                  <Shield />
                </S.HeroProofIcon>
                <S.HeroProofContent>
                  <S.HeroProofTitle>Non-custodial by design</S.HeroProofTitle>
                  <S.HeroProofNote>Your wallet stays in control while you execute on-chain.</S.HeroProofNote>
                </S.HeroProofContent>
              </S.HeroProofCard>
              <S.HeroProofCard>
                <S.HeroProofIcon>
                  <Gift />
                </S.HeroProofIcon>
                <S.HeroProofContent>
                  <S.HeroProofTitle>More than a swap</S.HeroProofTitle>
                  <S.HeroProofNote>Liquidity, staking, rewards, and governance in one ecosystem.</S.HeroProofNote>
                </S.HeroProofContent>
              </S.HeroProofCard>
            </S.HeroProofGrid>
          </S.HeroContent>

          {/* Swap Preview */}
          <S.SwapPreview $delay="0.4s">
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
                <span>Non-custodial flow</span>
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
              <div><ArrowDown /></div>
            </S.SwapArrow>
            <S.SwapField>
              <S.SwapFieldLeft>
                <img src="/img/lusdt.svg" alt="USDT" />
                <span>lUSDT</span>
              </S.SwapFieldLeft>
              <S.SwapFieldRight>
                <div className="amount">45.00</div>
                <div className="usd">≈ $45.00</div>
              </S.SwapFieldRight>
            </S.SwapField>
            <S.SwapButton>Review Route</S.SwapButton>
            <S.SwapInfo>
              <span>Fee: 0.5%</span>
              <span>Execution estimate: less than 3s</span>
            </S.SwapInfo>
          </S.SwapPreview>
        </S.HeroGrid>
      </S.HeroSection>

      {/* STATS */}
      <S.StatsBar className="reveal-on-scroll" $delay="0.1s">
        <S.StatsGrid>
          <S.StatItem>
            <S.StatVal>$<Counter end={12} suffix="M+" /></S.StatVal>
            <S.StatLabel>Value secured in the ecosystem</S.StatLabel>
          </S.StatItem>
          <S.StatItem>
            <S.StatVal><Counter end={50} suffix="K+" /></S.StatVal>
            <S.StatLabel>Trades executed across Lunex flows</S.StatLabel>
          </S.StatItem>
          <S.StatItem>
            <S.StatVal><Counter end={10} suffix="K+" /></S.StatVal>
            <S.StatLabel>Wallets already active in the community</S.StatLabel>
          </S.StatItem>
          <S.StatItem>
            <S.StatVal>0.5%</S.StatVal>
            <S.StatLabel>Simple fee structure for trading</S.StatLabel>
          </S.StatItem>
        </S.StatsGrid>
      </S.StatsBar>

      {/* FEATURES */}
      <S.Section id="features">
        <S.STitle>One place to <span>trade and grow</span></S.STitle>
        <S.SSub>Lunex is built to reduce friction, increase clarity, and give users more ways to extract value from the same ecosystem.</S.SSub>
        <S.FeatGrid>
          <S.FeatCard className="reveal-on-scroll" $delay="0.05s">
            <S.FeatIcon><Zap /></S.FeatIcon>
            <S.FeatTitle>Fast execution</S.FeatTitle>
            <S.FeatDesc>Trade with the pace modern users expect, with confirmations designed for a smoother on-chain experience.</S.FeatDesc>
          </S.FeatCard>
          <S.FeatCard className="reveal-on-scroll" $delay="0.1s">
            <S.FeatIcon><Shield /></S.FeatIcon>
            <S.FeatTitle>Wallet-first security</S.FeatTitle>
            <S.FeatDesc>Operate in a non-custodial flow that keeps ownership where it belongs and reinforces user trust at every step.</S.FeatDesc>
          </S.FeatCard>
          <S.FeatCard className="reveal-on-scroll" $delay="0.15s">
            <S.FeatIcon><Wallet /></S.FeatIcon>
            <S.FeatTitle>Simple economics</S.FeatTitle>
            <S.FeatDesc>A clear 0.5% fee keeps the offer easy to understand and makes the product stronger for recurring usage.</S.FeatDesc>
          </S.FeatCard>
          <S.FeatCard className="reveal-on-scroll" $delay="0.2s">
            <S.FeatIcon><Waves /></S.FeatIcon>
            <S.FeatTitle>Liquidity opportunities</S.FeatTitle>
            <S.FeatDesc>Move from swapping to liquidity provision with a consistent product language and stronger yield context.</S.FeatDesc>
          </S.FeatCard>
          <S.FeatCard className="reveal-on-scroll" $delay="0.25s">
            <S.FeatIcon><Gift /></S.FeatIcon>
            <S.FeatTitle>Rewards that compound usage</S.FeatTitle>
            <S.FeatDesc>Provide liquidity, stake LUNES, and turn platform participation into a repeatable rewards loop.</S.FeatDesc>
          </S.FeatCard>
          <S.FeatCard className="reveal-on-scroll" $delay="0.3s">
            <S.FeatIcon><Users /></S.FeatIcon>
            <S.FeatTitle>Governance with utility</S.FeatTitle>
            <S.FeatDesc>Go beyond passive holding and help shape the protocol through proposals, incentives, and community direction.</S.FeatDesc>
          </S.FeatCard>
        </S.FeatGrid>
      </S.Section>

      {/* CORE BENEFITS */}
      <S.Section id="core-benefits">
        <S.STitle>Advanced <span>Protocol Benefits</span></S.STitle>
        <S.SSub>Beyond a simple swap, Lunex introduces powerful mechanisms for serious traders and liquidity providers.</S.SSub>
        <S.FeatGrid style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <S.FeatCard className="reveal-on-scroll" $delay="0.05s">
            <S.FeatIcon><Droplet /></S.FeatIcon>
            <S.FeatTitle>Asymmetric Liquidity</S.FeatTitle>
            <S.FeatDesc>Independent buy and sell curves allow for optimized strategies, enabling you to automatically buy low and sell high without manual intervention.</S.FeatDesc>
          </S.FeatCard>
          <S.FeatCard className="reveal-on-scroll" $delay="0.1s">
            <S.FeatIcon><TrendingUp /></S.FeatIcon>
            <S.FeatTitle>Integrated Leverage</S.FeatTitle>
            <S.FeatDesc>Access lending and leverage directly through the protocol, or generate passive income by supplying assets to our native lending pools.</S.FeatDesc>
          </S.FeatCard>
          <S.FeatCard className="reveal-on-scroll" $delay="0.15s">
            <S.FeatIcon><Shuffle /></S.FeatIcon>
            <S.FeatTitle>Smart Routing</S.FeatTitle>
            <S.FeatDesc>Advanced arbitrage algorithms automatically explore the best exchange rates in real-time across all available pools to ensure maximum output.</S.FeatDesc>
          </S.FeatCard>
          <S.FeatCard className="reveal-on-scroll" $delay="0.2s">
            <S.FeatIcon><Shield /></S.FeatIcon>
            <S.FeatTitle>Impermanent Loss Protection</S.FeatTitle>
            <S.FeatDesc>Significantly reduce the risk of traditional Impermanent Loss through our innovative directional liquidity strategies and dynamic fee structures.</S.FeatDesc>
          </S.FeatCard>
        </S.FeatGrid>
      </S.Section>

      {/* HIGHLIGHTS */}
      <S.Section id="highlights" style={{ background: 'rgba(10,8,8,1)' }}>
        <S.STitle>Proof that the experience is <span>built to convert</span></S.STitle>
        <S.SSub>Clear economics, fast flows, and ownership-first execution create a value proposition users can understand in seconds.</S.SSub>
        <S.HLGrid>
          <S.HLCard className="reveal-on-scroll" $delay="0.05s" $accent="#6C38FF">
            <S.HLVal>0.5%</S.HLVal>
            <S.HLLabel>Clear trading fee</S.HLLabel>
            <S.HLDesc>Simple pricing removes hesitation and helps users act faster.</S.HLDesc>
          </S.HLCard>
          <S.HLCard className="reveal-on-scroll" $delay="0.1s" $accent="#26D07C">
            <S.HLVal>&lt;3s</S.HLVal>
            <S.HLLabel>Execution feel</S.HLLabel>
            <S.HLDesc>A faster product experience improves trust and repeat usage.</S.HLDesc>
          </S.HLCard>
          <S.HLCard className="reveal-on-scroll" $delay="0.15s" $accent="#9469FF">
            <S.HLVal>100%</S.HLVal>
            <S.HLLabel>Non-custodial</S.HLLabel>
            <S.HLDesc>Users keep ownership of wallet access and on-chain participation.</S.HLDesc>
          </S.HLCard>
          <S.HLCard className="reveal-on-scroll" $delay="0.2s" $accent="#FE5F00">
            <S.HLVal>24/7</S.HLVal>
            <S.HLLabel>Always accessible</S.HLLabel>
            <S.HLDesc>The ecosystem stays available for trading, earning, and participation whenever users are ready.</S.HLDesc>
          </S.HLCard>
        </S.HLGrid>
      </S.Section>

      {/* COMPARISON */}
      <S.CompSection id="comparison">
        <S.STitle>How Lunex <span>positions itself</span></S.STitle>
        <S.SSub>A competitive profile matters, but the real advantage is combining execution, rewards, and governance in one coherent user journey.</S.SSub>
        <S.CompTable>
          <S.CompHead>
            <S.CompHCell>DEX</S.CompHCell>
            <S.CompHCell>Fee</S.CompHCell>
            <S.CompHCell>Speed</S.CompHCell>
            <S.CompHCell>Rewards</S.CompHCell>
            <S.CompHCell>Staking</S.CompHCell>
          </S.CompHead>
          <S.CompRow $hl>
            <S.CompCell><S.DexName $main><img src="/img/lunes.svg" alt="Lunex" /><span>Lunex</span></S.DexName></S.CompCell>
            <S.CompCell $green>0.5%</S.CompCell>
            <S.CompCell $green>&lt;3s</S.CompCell>
            <S.CompCell $green><Check /> Rewards layer</S.CompCell>
            <S.CompCell $green><Check /> Up to 25%</S.CompCell>
          </S.CompRow>
          <S.CompRow>
            <S.CompCell><S.DexName><img src="/img/ethereum.svg" alt="Uniswap" /><span>Uniswap</span></S.DexName></S.CompCell>
            <S.CompCell>0.3%</S.CompCell>
            <S.CompCell>~15s</S.CompCell>
            <S.CompCell><X /> No</S.CompCell>
            <S.CompCell><X /> No</S.CompCell>
          </S.CompRow>
          <S.CompRow>
            <S.CompCell><S.DexName><img src="/img/solana.svg" alt="Raydium" /><span>Raydium</span></S.DexName></S.CompCell>
            <S.CompCell>0.25%</S.CompCell>
            <S.CompCell>~1s</S.CompCell>
            <S.CompCell><Check /> Basic</S.CompCell>
            <S.CompCell><Check /> Variable</S.CompCell>
          </S.CompRow>
          <S.CompRow>
            <S.CompCell><S.DexName><img src="/img/ethereum.svg" alt="SushiSwap" /><span>SushiSwap</span></S.DexName></S.CompCell>
            <S.CompCell>0.3%</S.CompCell>
            <S.CompCell>~15s</S.CompCell>
            <S.CompCell><Check /> Basic</S.CompCell>
            <S.CompCell><Check /> xSUSHI</S.CompCell>
          </S.CompRow>
        </S.CompTable>
      </S.CompSection>

      {/* ECOSYSTEM */}
      <S.Section id="ecosystem">
        <S.STitle>One ecosystem, <span>multiple entry points</span></S.STitle>
        <S.SSub>Users can start with a simple swap and naturally expand into liquidity, staking, rewards, and governance as conviction grows.</S.SSub>
        <S.EcoGrid>
          <S.EcoCard className="reveal-on-scroll" $delay="0.05s" onClick={() => navigate('/swap')}>
            <BarChart3 size={48} color="#6C38FF" />
            <h4>Swap</h4>
            <p>Start with the fastest path to execution and token conversion.</p>
          </S.EcoCard>
          <S.EcoCard className="reveal-on-scroll" $delay="0.1s" onClick={() => navigate('/pools')}>
            <Layers size={48} color="#26D07C" />
            <h4>Pools</h4>
            <p>Put idle capital to work and capture fees from ecosystem activity.</p>
          </S.EcoCard>
          <S.EcoCard className="reveal-on-scroll" $delay="0.15s" onClick={() => navigate('/staking')}>
            <Coins size={48} color="#FFD700" />
            <h4>Staking</h4>
            <p>Turn long-term conviction into yield and governance participation.</p>
          </S.EcoCard>
          <S.EcoCard className="reveal-on-scroll" $delay="0.2s" onClick={() => navigate('/rewards')}>
            <Gift size={48} color="#FE5F00" />
            <h4>Rewards</h4>
            <p>Unlock tiers and multipliers that strengthen continued platform use.</p>
          </S.EcoCard>
          <S.EcoCard className="reveal-on-scroll" $delay="0.25s" onClick={() => navigate('/governance')}>
            <Globe size={48} color="#9469FF" />
            <h4>Governance</h4>
            <p>Help direct incentives, proposals, and the future of the protocol.</p>
          </S.EcoCard>
        </S.EcoGrid>
      </S.Section>

      {/* HOW IT WORKS */}
      <S.Section id="how-it-works">
        <S.STitle>From first click to <span>first result</span></S.STitle>
        <S.SSub>The onboarding path is designed to lower friction, build confidence, and move users toward action quickly.</S.SSub>
        <S.StepsWrap>
          <S.Step className="reveal-on-scroll" $delay="0.1s">
            <S.StepNum>1</S.StepNum>
            <S.StepBody>
              <h3>Connect your wallet</h3>
              <p>Enter with a wallet-first flow that keeps access simple and ownership visible from the start.</p>
            </S.StepBody>
          </S.Step>
          <S.Step className="reveal-on-scroll" $delay="0.2s">
            <S.StepNum>2</S.StepNum>
            <S.StepBody>
              <h3>Choose the pair</h3>
              <p>Review supported assets, read the route clearly, and understand your expected output before confirming.</p>
            </S.StepBody>
          </S.Step>
          <S.Step className="reveal-on-scroll" $delay="0.3s">
            <S.StepNum>3</S.StepNum>
            <S.StepBody>
              <h3>Execute and expand</h3>
              <p>Start with a swap, then move into liquidity, staking, rewards, or governance as your strategy evolves.</p>
            </S.StepBody>
          </S.Step>
        </S.StepsWrap>
      </S.Section>

      {/* CTA */}
      <S.CTASection>
        <S.CTACard>
          <S.CTATitle>Make your first move on Lunex</S.CTATitle>
          <S.CTADesc>
            Start with a simple swap, discover the ecosystem, and turn a first transaction into a long-term on-chain strategy.
          </S.CTADesc>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <S.PrimaryBtn onClick={() => navigate('/swap')}>
              Launch App <ArrowRight />
            </S.PrimaryBtn>
          </div>
        </S.CTACard>
      </S.CTASection>

      {/* FOOTER */}
      <S.Footer>
        <S.FooterGrid>
          <S.FooterBrand>
            <img src="/img/lunes-logo.svg" alt="Lunex" />
            <p>The execution layer for trading, rewards, and governance on Lunes.</p>
          </S.FooterBrand>
          <S.FooterCol>
            <h4>Products</h4>
            <a href="/swap">Swap</a>
            <a href="/pools">Liquidity Pools</a>
            <a href="/staking">Staking</a>
            <a href="/governance">Governance</a>
          </S.FooterCol>
          <S.FooterCol>
            <h4>Resources</h4>
            <a href="https://docs.lunes.io" target="_blank" rel="noopener noreferrer">Documentation</a>
            <a href="https://github.com/lunes-platform" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href="#">Whitepaper</a>
          </S.FooterCol>
          <S.FooterCol>
            <h4>Community</h4>
            <a href="https://twitter.com/LunesBlockchain" target="_blank" rel="noopener noreferrer">Twitter</a>
            <a href="https://discord.gg/lunes" target="_blank" rel="noopener noreferrer">Discord</a>
            <a href="https://t.me/LunesPlatform" target="_blank" rel="noopener noreferrer">Telegram</a>
          </S.FooterCol>
        </S.FooterGrid>
        <S.FooterBottom>
          <p>&copy; {new Date().getFullYear()} Lunex. All rights reserved.</p>
          <S.SocialRow>
            <a href="https://twitter.com/LunesBlockchain" target="_blank" rel="noopener noreferrer" aria-label="Twitter"><Twitter /></a>
            <a href="https://discord.gg/lunes" target="_blank" rel="noopener noreferrer" aria-label="Discord"><MessageCircle /></a>
            <a href="https://t.me/LunesPlatform" target="_blank" rel="noopener noreferrer" aria-label="Telegram"><Send /></a>
            <a href="https://github.com/lunes-platform" target="_blank" rel="noopener noreferrer" aria-label="GitHub"><Github /></a>
          </S.SocialRow>
        </S.FooterBottom>
      </S.Footer>
    </S.Page>
  )
}

export default Landing
