import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { C, EASE_OUT, Page, grotesk, tabular } from '../../components/ui/kit'
import { fadeIn } from '../../styles/motion'

type DocSection = {
  k: string
  label: string
  kicker: string
  title: string
  paras: string[]
  rows?: [string, string][]
}

const DOCS: DocSection[] = [
  {
    k: 'start',
    label: 'Getting started',
    kicker: 'Basics',
    title: 'Getting started',
    paras: [
      'Lunex is a non-custodial exchange on the Lunes blockchain. Your funds stay in your wallet; every action is a transaction you sign.',
      'Connect Lunes Wallet, SubWallet or Talisman from the button in the top-right corner. Once connected, your balances appear in the swap card and token list.',
      'Every flow shows its outcome before you sign: what you pay, what you receive at minimum, the fees and how many signatures it takes.'
    ]
  },
  {
    k: 'swap',
    label: 'Swapping',
    kicker: 'Trade',
    title: 'Swapping tokens',
    paras: [
      'Pick the token you pay and the token you receive, then type an amount. The quote updates instantly and shows price impact, minimum received and the route.',
      'Slippage tolerance is the maximum price change you accept between signing and confirmation. If the price moves more, the swap reverts and nothing is spent.',
      'The first time you swap a token, your wallet asks you to approve spending. This is a one-time signature per token.'
    ]
  },
  {
    k: 'liquidity',
    label: 'Liquidity',
    kicker: 'Earn',
    title: 'Providing liquidity',
    paras: [
      'Deposit two tokens in the ratio set by the pool price. You receive LP tokens that represent your share of the pool.',
      'Liquidity providers earn 0.3% of every swap routed through their pool, paid into the pool and claimable when you withdraw.',
      'Withdraw any percentage at any time. Your share is converted back into both tokens at the current pool ratio.'
    ]
  },
  {
    k: 'staking',
    label: 'Staking',
    kicker: 'Earn',
    title: 'Staking LUNES',
    paras: [
      'Stake LUNES to earn staking rewards and voting power for governance. Rewards accrue every block and the staking contract sets the lock period.',
      'Rewards are multiplied by your tier — up to 3× at Platinum. Claim them at any time from the Rewards page without unstaking.'
    ]
  },
  {
    k: 'spot',
    label: 'Spot trading',
    kicker: 'Trade',
    title: 'Spot orderbook',
    paras: [
      'Place limit orders at the price you choose or market orders at the best available price. Orders settle on-chain.',
      'Open orders can be cancelled at any time. Partially filled orders keep their remaining size on the book.',
      'Spot fees are 0.10% for makers and 0.25% for takers, charged on every matched trade.'
    ]
  },
  {
    k: 'fees',
    label: 'Fees',
    kicker: 'Reference',
    title: 'Fees',
    paras: [
      'Every swap pays a 0.5% fee, split three ways. Fee changes are decided by governance.'
    ],
    rows: [
      ['Liquidity providers', '0.30%'],
      ['Protocol / team', '0.10%'],
      ['Trading rewards (stakers)', '0.10%'],
      ['Total swap fee', '0.50%']
    ]
  },
  {
    k: 'security',
    label: 'Security',
    kicker: 'Reference',
    title: 'Security',
    paras: [
      'Lunex never holds your keys or funds. The contracts are open source and every fund-moving action requires your signature.',
      'Agent API keys can only trade within the limits you sign; they can never withdraw. Always check the address and amount in your wallet before signing.'
    ]
  }
]

const readHash = () => {
  const h = window.location.hash.replace('#', '')
  return DOCS.some(d => d.k === h) ? h : DOCS[0].k
}

// ─── Styles ──────────────────────────────────────────────────────

const Layout = styled.div`
  display: flex;
  gap: 24px;
  align-items: flex-start;
  @media (max-width: 759px) {
    flex-direction: column;
    gap: 16px;
  }
`

const Nav = styled.nav`
  flex: 0 0 220px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  position: sticky;
  top: 88px;
  @media (max-width: 759px) {
    position: static;
    flex: none;
    width: 100%;
    flex-direction: row;
    overflow-x: auto;
    scrollbar-width: none;
    &::-webkit-scrollbar {
      display: none;
    }
  }
`

const NavLabel = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: ${C.muted};
  padding: 0 10px 8px;
  @media (max-width: 759px) {
    display: none;
  }
`

const NavBtn = styled.button<{ $on: boolean }>`
  text-align: left;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: ${p => (p.$on ? C.field : 'transparent')};
  color: ${p => (p.$on ? '#fff' : C.muted)};
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
  transition:
    color 150ms ease,
    background 150ms ease;
  &:hover {
    color: #fff;
  }
`

const Article = styled.article`
  flex: 1 1 480px;
  min-width: 0;
  max-width: 720px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  animation: ${fadeIn} 200ms ${EASE_OUT} both;
  @media (max-width: 759px) {
    flex: none;
    width: 100%;
  }
`

const Kicker = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: ${C.primaryText};
`

const Title = styled.h1`
  ${grotesk};
  font-size: 34px;
  font-weight: 600;
  line-height: 1.15;
  @media (max-width: 759px) {
    font-size: 28px;
  }
`

const P = styled.p`
  font-size: 15px;
  line-height: 1.7;
  color: ${C.body};
`

const FeeTable = styled.div`
  border: 1px solid ${C.border};
  border-radius: 14px;
  overflow: hidden;
  margin-top: 6px;
  ${tabular};
`

const FeeRow = styled.div<{ $total: boolean }>`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  font-size: 14px;
  background: ${p => (p.$total ? C.surface : 'transparent')};
  font-weight: ${p => (p.$total ? 600 : 400)};
  & + & {
    border-top: 1px solid ${C.border};
  }
  > span:first-child {
    color: ${p => (p.$total ? '#fff' : C.secondary)};
  }
  > span:last-child {
    font-weight: 600;
    text-align: right;
  }
`

const PrevNext = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid ${C.border};
  button {
    background: none;
    border: none;
    padding: 0;
    color: ${C.primaryText};
    font-size: 14px;
    font-weight: 600;
    &:hover {
      color: ${C.primaryText2};
    }
  }
`

// ─── Component ───────────────────────────────────────────────────

const Docs: React.FC = () => {
  const [sec, setSec] = useState<string>(readHash)

  useEffect(() => {
    const onHash = () => setSec(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = (k: string) => {
    setSec(k)
    window.history.replaceState(null, '', `#${k}`)
    window.scrollTo({ top: 0 })
  }

  const i = Math.max(
    0,
    DOCS.findIndex(d => d.k === sec)
  )
  const doc = DOCS[i]
  const prev = DOCS[i - 1]
  const next = DOCS[i + 1]

  return (
    <Page $max={1080}>
      <Layout>
        <Nav aria-label="Documentation">
          <NavLabel>Documentation</NavLabel>
          {DOCS.map(d => (
            <NavBtn
              key={d.k}
              $on={d.k === doc.k}
              aria-current={d.k === doc.k ? 'page' : undefined}
              onClick={() => go(d.k)}
            >
              {d.label}
            </NavBtn>
          ))}
        </Nav>

        <Article key={doc.k}>
          <Kicker>{doc.kicker}</Kicker>
          <Title>{doc.title}</Title>
          {doc.paras.map(p => (
            <P key={p}>{p}</P>
          ))}
          {doc.rows && (
            <FeeTable>
              {doc.rows.map(([a, b], j) => (
                <FeeRow key={a} $total={j === doc.rows!.length - 1}>
                  <span>{a}</span>
                  <span>{b}</span>
                </FeeRow>
              ))}
            </FeeTable>
          )}
          <PrevNext>
            <button
              style={{ visibility: prev ? 'visible' : 'hidden' }}
              onClick={() => prev && go(prev.k)}
            >
              ← {prev?.label}
            </button>
            <button
              style={{ visibility: next ? 'visible' : 'hidden' }}
              onClick={() => next && go(next.k)}
            >
              {next?.label} →
            </button>
          </PrevNext>
        </Article>
      </Layout>
    </Page>
  )
}

export default Docs
