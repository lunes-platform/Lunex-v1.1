import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { Copy } from 'lucide-react'
import { C, SkeletonLine, grotesk, short } from 'components/ui/kit'
import AnimatedNumber from 'components/ui/AnimatedNumber'
import { useToast } from 'components/feedback/ToastProvider'
import { useSDK } from 'context/SDKContext'
import usePools, { Pool } from 'hooks/usePools'
import { fmtAmount, toNative } from '../BalanceDropdown'
import { Popover } from '../styles'
import { currentWallet } from './wallets'

const SPOT_API = process.env.REACT_APP_SPOT_API_URL || 'http://localhost:4000'

type LpPosition = { pool: Pool; share: number; usd: number }

// Last results per address, so re-opening the panel renders instantly
// while fresh values load.
const cache: Record<
  string,
  {
    staked?: number
    stakeRewards?: number
    affiliate?: number
    lp?: LpPosition[]
  }
> = {}

const Head = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  > img {
    width: 36px;
    height: 36px;
    border-radius: 10px;
  }
`

const Addr = styled.div`
  ${grotesk};
  font-weight: 600;
  font-size: 15px;
`

const SmallBtn = styled.button`
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid ${C.borderStrong};
  background: transparent;
  color: ${C.text};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  &:hover {
    border-color: ${C.primary};
  }
`

const ValueBox = styled.div`
  background: ${C.bg};
  border-radius: 12px;
  padding: 14px;
  div:first-child {
    font-size: 12px;
    color: ${C.muted};
    margin-bottom: 4px;
  }
  strong {
    ${grotesk};
    display: block;
    font-size: 24px;
    font-weight: 600;
  }
  small {
    font-size: 11px;
    color: ${C.muted};
  }
`

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  > span:first-child {
    font-size: 12px;
    font-weight: 600;
    color: ${C.muted};
  }
`

const Line = styled.div<{ $green?: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  > span:first-child {
    color: ${C.secondary};
  }
  > span:last-child,
  > button:last-child {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: ${p => (p.$green ? C.success : C.text)};
  }
`

const LinkBtn = styled.button`
  border: none;
  background: none;
  padding: 0;
  font-size: 13px;
  &:hover {
    text-decoration: underline;
  }
`

const PairBtn = styled.button`
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid ${C.border};
  background: ${C.bg};
  color: ${C.text};
  text-align: left;
  &:hover {
    border-color: ${C.primary};
  }
  img {
    width: 22px;
    height: 22px;
    border-radius: 50%;
  }
  img + img {
    margin-left: -6px;
    border: 2px solid ${C.bg};
  }
  b {
    flex: 1;
    font-size: 13px;
    font-weight: 600;
  }
  span {
    font-size: 13px;
    color: ${C.secondary};
    font-variant-numeric: tabular-nums;
  }
`

const RefBox = styled.div`
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid ${C.border};
  background: ${C.bg};
  font-family: ui-monospace, monospace;
  font-size: 12px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  display: block;
  line-height: 34px;
`

const CopyBtn = styled.button`
  height: 36px;
  padding: 0 12px;
  border: none;
  border-radius: 8px;
  background: ${C.primary};
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  &:hover {
    background: ${C.primaryHover};
  }
`

const FootBtn = styled.button<{ $danger?: boolean }>`
  ${grotesk};
  flex: 1;
  height: 40px;
  border-radius: 10px;
  border: 1px solid ${C.borderStrong};
  background: transparent;
  color: ${p => (p.$danger ? C.criticalText : C.text)};
  font-weight: 600;
  font-size: 13px;
  &:hover {
    border-color: ${p => (p.$danger ? C.criticalText : C.primary)};
  }
`

const copyText = (text: string) => {
  try {
    void navigator.clipboard?.writeText(text)
  } catch {
    // clipboard unavailable
  }
}

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`

const AccountPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const sdk = useSDK()
  const navigate = useNavigate()
  const { toast } = useToast()
  const address = sdk.walletAddress || ''
  const wallet = currentWallet()
  const { pools, isLoading: poolsLoading, getUserLiquidity } = usePools()
  const [data, setData] = useState(() => cache[address] ?? {})

  const native = toNative(sdk.balance)
  const refLink = `${window.location.origin}/?ref=${address}`

  // Staking (on-chain) + affiliate earnings (spot-api, unsigned read).
  useEffect(() => {
    if (!address) return
    let alive = true
    const merge = (patch: typeof data) => {
      cache[address] = { ...cache[address], ...patch }
      if (alive) setData(d => ({ ...d, ...patch }))
    }
    sdk
      .getStakingUserInfo(address)
      .then(info =>
        merge({
          staked: toNative(info?.userStaked),
          stakeRewards: toNative(info?.pendingRewards)
        })
      )
      .catch(() => merge({ staked: 0, stakeRewards: 0 }))
    fetch(`${SPOT_API}/api/v1/affiliates/dashboard?address=${address}`)
      .then(r => (r.ok ? r.json() : null))
      .then(res => {
        const d = res?.dashboard
        merge({ affiliate: Number(d?.totalUnpaid ?? d?.totalEarnings ?? 0) })
      })
      .catch(() => merge({ affiliate: 0 }))
    return () => {
      alive = false
    }
  }, [address]) // eslint-disable-line react-hooks/exhaustive-deps

  // LP positions: LP token balance per discovered pair.
  useEffect(() => {
    if (!address || poolsLoading) return
    let alive = true
    Promise.all(
      pools.map(async pool => {
        const lp = Number(await getUserLiquidity(pool.pairAddress))
        const supply = Number(pool.totalSupply || 0)
        const share = lp > 0 && supply > 0 ? lp / supply : 0
        return { pool, share, usd: share * (pool.liquidity || 0) }
      })
    ).then(all => {
      const lp = all.filter(p => p.share > 0.000001)
      cache[address] = { ...cache[address], lp }
      if (alive) setData(d => ({ ...d, lp }))
    })
    return () => {
      alive = false
    }
  }, [address, pools, poolsLoading, getUserLiquidity])

  const lpUsd = data.lp?.reduce((s, p) => s + p.usd, 0)

  const go = (to: string) => {
    navigate(to)
    onClose()
  }

  const loading = <SkeletonLine $w="64px" $h={12} />

  return (
    <Popover
      $width={340}
      $pad={16}
      $mobileFixed
      role="dialog"
      aria-label="Account"
      style={{ gap: 14 }}
    >
      <Head>
        <img src={wallet.icon} alt="" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Addr>{short(address)}</Addr>
          <div style={{ fontSize: 12, color: C.muted }}>
            {wallet.name} · Lunes network
          </div>
        </div>
        <SmallBtn
          aria-label="Copy address"
          onClick={() => {
            copyText(address)
            toast('success', 'Address copied', short(address))
          }}
        >
          <Copy size={15} strokeWidth={2} />
        </SmallBtn>
      </Head>

      <ValueBox>
        <div>Portfolio value</div>
        <strong>
          {/* PLACEHOLDER: no USD price feed yet — shows LUNES (wallet + staked). */}
          <AnimatedNumber
            text={`${fmtAmount(native + (data.staked ?? 0))} LUNES`}
          />
        </strong>
        <small>Wallet + staked · USD valuation coming soon</small>
      </ValueBox>

      <Section>
        <span>Your position</span>
        <Line>
          <span>Wallet tokens</span>
          <span>{fmtAmount(native)} LUNES</span>
        </Line>
        <Line>
          <span>Liquidity positions</span>
          {data.lp ? (
            <span>{lpUsd ? usd(lpUsd) : `${data.lp.length} pair(s)`}</span>
          ) : (
            loading
          )}
        </Line>
        <Line>
          <span>Staked</span>
          {data.staked !== undefined ? (
            <span>{fmtAmount(data.staked)} LUNES</span>
          ) : (
            loading
          )}
        </Line>
      </Section>

      {data.lp && data.lp.length > 0 && (
        <Section>
          <span>Active pairs</span>
          {data.lp.map(({ pool, share, usd: v }) => (
            <PairBtn
              key={pool.pairAddress}
              title="Remove liquidity"
              onClick={() =>
                go(
                  `/pool?tab=remove&pair=${encodeURIComponent(pool.pairAddress)}`
                )
              }
            >
              <div style={{ display: 'flex' }}>
                <img src={pool.token0.icon} alt="" />
                <img src={pool.token1.icon} alt="" />
              </div>
              <b>
                {pool.token0.symbol}/{pool.token1.symbol}
              </b>
              <span>
                {v > 0 ? usd(v) : `${(share * 100).toFixed(2)}% share`}
              </span>
            </PairBtn>
          ))}
        </Section>
      )}

      <Section>
        <span>Your referral link</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <RefBox title={refLink}>{refLink.replace(/^https?:\/\//, '')}</RefBox>
          <CopyBtn
            onClick={() => {
              copyText(refLink)
              toast('success', 'Link copied', short(refLink, 24, 6))
            }}
          >
            Copy
          </CopyBtn>
        </div>
      </Section>

      <Section>
        <span>Earnings</span>
        <Line $green>
          <span>Staking rewards</span>
          {data.stakeRewards !== undefined ? (
            <span>{fmtAmount(data.stakeRewards)} LUNES</span>
          ) : (
            loading
          )}
        </Line>
        <Line $green>
          <span>Trading rewards</span>
          {/* Pending trading rewards need a signed request — link out instead
              of prompting the wallet just for opening this panel. */}
          <LinkBtn onClick={() => go('/rewards')}>View</LinkBtn>
        </Line>
        <Line $green>
          <span>Affiliate commissions</span>
          {data.affiliate !== undefined ? (
            <span>{usd(data.affiliate)}</span>
          ) : (
            loading
          )}
        </Line>
      </Section>

      <div style={{ display: 'flex', gap: 8 }}>
        <FootBtn onClick={() => go('/activity')}>Activity</FootBtn>
        <FootBtn
          $danger
          onClick={() => {
            sdk.disconnectWallet()
            onClose()
            toast('info', 'Wallet disconnected', undefined, { silent: true })
          }}
        >
          Disconnect
        </FootBtn>
      </div>
    </Popover>
  )
}

export default AccountPanel
