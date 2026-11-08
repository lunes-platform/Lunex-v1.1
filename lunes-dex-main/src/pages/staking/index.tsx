/**
 * Staking — stakes NATIVE LUNES in the staking contract
 * (Lunex/contracts/staking/lib.rs): payable `stake(duration_ms)`, one
 * position per wallet, `unstake()` withdraws everything (5% penalty before
 * the lock ends), `claim_rewards()` pays accrued rewards in LUNES.
 * Durations, tiers and APR mirror the contract constants (utils/staking).
 */
import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled, { css } from 'styled-components'
import { AlertTriangle, ArrowRight, Clock } from 'lucide-react'
import { useSDK } from '../../context/SDKContext'
import { useTx } from '../../context/TxContext'
import { CONTRACTS } from '../../config/contracts'
import {
  Button,
  C,
  Divider,
  H1,
  KV,
  MainCard,
  Notice,
  Page,
  Panel,
  Sub,
  TabPanel,
  Tabs,
  grotesk,
  tabular,
  tint
} from 'components/ui/kit'
import { AnimatedNumber } from 'components/ui/AnimatedNumber'
import { requestWalletConnect } from 'pages/header/modals/wallets'
import {
  EARLY_UNSTAKE_PENALTY_BPS,
  LUNES_DECIMALS,
  MIN_STAKE_PLANCK,
  STAKE_DURATION_OPTIONS,
  TIER_APR_BPS,
  estimateAprBps,
  tierForDurationMs
} from '../../utils/staking'
import type { StakePositionView } from '../../utils/staking'
import { maxSpendableNative } from '../../utils/gasReserve'

// The staking contract is optional until deployed on the target network.
const stakingAvailable = CONTRACTS.STAKING.length >= 10

type StakingInfo = {
  totalStaked: string
  userStaked: string
  pendingRewards: string
  apr: string
  lockPeriod: number
  position: StakePositionView | null
  rewardsPool: string | null
}

type StakeTab = 'stake' | 'unstake'

const fmt = (v: number, max = 4) =>
  v.toLocaleString('en-US', { maximumFractionDigits: max })

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

const toBig = (v?: string | null) => {
  try {
    return BigInt(v || '0')
  } catch {
    return BigInt(0)
  }
}

const MIN_STAKE_LUNES = Number(MIN_STAKE_PLANCK) / 10 ** LUNES_DECIMALS
const APR_RANGE = `${TIER_APR_BPS.Bronze / 100}–${TIER_APR_BPS.Platinum / 100}%`

const Staking: React.FC = () => {
  const sdk = useSDK()
  const tx = useTx()
  const navigate = useNavigate()

  const [info, setInfo] = useState<StakingInfo | null>(null)
  const [nativeRaw, setNativeRaw] = useState('0')
  const [tab, setTab] = useState<StakeTab>('stake')
  const [amount, setAmount] = useState('')
  const [durationIdx, setDurationIdx] = useState(0)

  const refresh = useCallback(async () => {
    if (!sdk.walletAddress) return
    try {
      setNativeRaw((await sdk.getNativeBalance(sdk.walletAddress)) || '0')
    } catch (err: unknown) {
      console.error('Error fetching LUNES balance:', err)
    }
    if (!stakingAvailable) return
    const userInfo = await sdk.getStakingUserInfo(sdk.walletAddress)
    if (userInfo) setInfo(userInfo)
  }, [sdk])

  useEffect(() => {
    refresh()
  }, [refresh])

  const toNum = (raw?: string) =>
    raw ? Number(sdk.formatAmount(raw, LUNES_DECIMALS)) || 0 : 0

  const position = info?.position ?? null
  const hasPosition = !!position?.active
  const totalStaked = toNum(info?.totalStaked)
  const staked = toNum(info?.userStaked)
  const rewards = toNum(info?.pendingRewards)
  // Rewards are paid only from the funded pool (never from principal).
  const pool = info?.rewardsPool != null ? toNum(info.rewardsPool) : null
  const poolShort = pool !== null && rewards > pool
  const spendableRaw = maxSpendableNative(nativeRaw)
  const available = toNum(spendableRaw)
  const connected = sdk.isConnected

  const option = STAKE_DURATION_OPTIONS[durationIdx]
  const amountRaw = toBig(sdk.parseAmount(amount || '0', LUNES_DECIMALS))
  const amt = Number(amount) || 0
  const now = Date.now()
  const locked = hasPosition && now < (position?.unlockAt ?? 0)
  const penalty = locked
    ? (staked * EARLY_UNSTAKE_PENALTY_BPS) / 10_000
    : 0

  // APR shown: the position's when staked, otherwise the selected preset
  // with the quantity multiplier of the typed amount.
  const aprBps = hasPosition
    ? Number(info?.apr || 0) * 100
    : estimateAprBps(option.tier, amountRaw)
  const lockDays = hasPosition ? info?.lockPeriod || 0 : option.days

  const switchTab = (t: StakeTab) => {
    setTab(t)
    setAmount('')
  }

  const onAmount = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.replace(',', '.')
    if (v === '' || /^\d*\.?\d{0,8}$/.test(v)) setAmount(v)
  }

  const runStake = () => {
    const value = sdk.parseAmount(amount, LUNES_DECIMALS)
    const { days, durationMs, tier } = option
    const label = fmt(amt)
    tx.run({
      type: 'staking',
      title: 'Staking',
      summary: `${label} LUNES · ${days} days · ${tier}`,
      actTitle: `Stake ${label} LUNES for ${days} days`,
      successTitle: 'LUNES staked',
      errorText: 'The stake did not complete.',
      steps: [
        {
          label: 'Sign stake in your wallet',
          wallet: true,
          run: ({ advance }) =>
            sdk.stake(value, durationMs).then(ok => {
              if (ok) advance()
              return ok
            })
        },
        { label: 'Waiting for finalization' }
      ],
      onSuccess: () => {
        setAmount('')
        refresh()
      }
    })
  }

  const runUnstake = () => {
    const label = fmt(staked)
    tx.run({
      type: 'staking',
      title: 'Unstaking',
      summary: locked
        ? `${label} LUNES · early (−${fmt(penalty)} LUNES penalty)`
        : `${label} LUNES + rewards`,
      actTitle: `Unstake ${label} LUNES`,
      successTitle: 'LUNES unstaked',
      errorText: 'The unstake did not complete.',
      steps: [
        {
          label: 'Sign unstake in your wallet',
          wallet: true,
          run: ({ advance }) =>
            sdk.unstake().then(ok => {
              if (ok) advance()
              return ok
            })
        },
        { label: 'Waiting for finalization' }
      ],
      onSuccess: () => refresh()
    })
  }

  const runClaim = () => {
    if (rewards <= 0) return
    const label = fmt(rewards)
    tx.run({
      type: 'staking',
      title: 'Claiming rewards',
      summary: `${label} LUNES`,
      actTitle: `Claim ${label} LUNES`,
      successTitle: 'Rewards claimed',
      errorText: 'The claim did not complete.',
      steps: [
        {
          label: 'Sign claim in your wallet',
          wallet: true,
          run: ({ advance }) =>
            sdk.claimStakingRewards().then(ok => {
              if (ok) advance()
              return ok
            })
        },
        { label: 'Waiting for finalization' }
      ],
      onSuccess: () => refresh()
    })
  }

  let cta: { label: string; onClick?: () => void; ok: boolean }
  if (!connected) {
    cta = {
      label: 'Connect wallet',
      onClick: () => requestWalletConnect(),
      ok: true
    }
  } else if (!stakingAvailable) {
    cta = { label: 'Staking opens soon', ok: false }
  } else if (tab === 'stake') {
    if (hasPosition) {
      cta = { label: 'You already have an active stake', ok: false }
    } else if (amt <= 0) {
      cta = { label: 'Enter an amount', ok: false }
    } else if (amountRaw < MIN_STAKE_PLANCK) {
      cta = { label: `Minimum ${fmt(MIN_STAKE_LUNES)} LUNES`, ok: false }
    } else if (amountRaw > toBig(spendableRaw)) {
      cta = { label: 'Insufficient LUNES (keep some for fees)', ok: false }
    } else {
      cta = { label: 'Stake LUNES', onClick: runStake, ok: true }
    }
  } else if (!hasPosition) {
    cta = { label: 'Nothing staked', ok: false }
  } else {
    cta = {
      label: locked ? 'Unstake early (5% penalty)' : 'Unstake all',
      onClick: runUnstake,
      ok: true
    }
  }

  const hint =
    amt > 0
      ? `${fmt(amt)} LUNES · locked ${option.days} days · ${tierForDurationMs(option.durationMs)}`
      : `Minimum ${fmt(MIN_STAKE_LUNES)} LUNES · one position per wallet`

  return (
    <Page $max={560}>
      <div>
        <H1>Staking</H1>
        <Sub>
          Stake LUNES for 7–365 days, earn {APR_RANGE} APR in LUNES and get
          voting power for governance.
        </Sub>
      </div>

      {!stakingAvailable && (
        <Notice $tone="primary" role="status">
          <Clock size={16} />
          <span>Staking opens once the contract is deployed on Lunes.</span>
        </Notice>
      )}

      <Stats>
        <Stat>
          <span>Total staked</span>
          <strong>
            <AnimatedNumber text={`${fmt(totalStaked, 2)} LUNES`} />
          </strong>
        </Stat>
        <Stat $accent>
          <span>{hasPosition ? 'Your APR' : 'APR'}</span>
          <strong>
            <AnimatedNumber text={`${fmt(aprBps / 100, 2)}%`} />
          </strong>
        </Stat>
        <Stat>
          <span>Lock period</span>
          <strong>
            <AnimatedNumber text={`${lockDays} days`} />
          </strong>
        </Stat>
      </Stats>

      {connected && (
        <Position>
          <PositionHead>
            <div>
              <SmallLabel>Pending rewards</SmallLabel>
              <Rewards>
                <AnimatedNumber text={`${fmt(rewards)} LUNES`} />
              </Rewards>
              <SmallLabel>
                {poolShort
                  ? `Claimable now ≈ ${fmt(pool ?? 0)} LUNES (rewards pool). The rest stays owed until the pool is refilled.`
                  : 'Accrues continuously · claim any time'}
              </SmallLabel>
            </div>
            <Button
              variant="success"
              disabled={rewards <= 0 || !stakingAvailable}
              onClick={runClaim}
            >
              Claim
            </Button>
          </PositionHead>
          <Divider />
          <KV>
            <span>Your stake</span>
            <span>
              <AnimatedNumber text={`${fmt(staked)} LUNES`} />
            </span>
          </KV>
          {hasPosition && position && (
            <>
              <KV>
                <span>Tier</span>
                <span>
                  {position.tier}
                  {position.earlyAdopterTier !== 'None'
                    ? ` · early adopter ${position.earlyAdopterTier}`
                    : ''}
                </span>
              </KV>
              <KV>
                <span>Unlocks</span>
                <span>{fmtDate(position.unlockAt)}</span>
              </KV>
            </>
          )}
          <KV>
            <span>Available to stake</span>
            <span>
              <AnimatedNumber text={`${fmt(available)} LUNES`} />
            </span>
          </KV>
        </Position>
      )}

      <StakeCard>
        <Tabs
          block
          ariaLabel="Stake or unstake"
          value={tab}
          onChange={switchTab}
          items={[
            { value: 'stake', label: 'Stake' },
            { value: 'unstake', label: 'Unstake' }
          ]}
        />
        <TabPanel key={tab}>
          {tab === 'stake' ? (
            <>
              {hasPosition && (
                <Notice $tone="neutral" role="status">
                  <Clock size={16} />
                  <span>
                    One position per wallet. Unstake your current position to
                    stake again.
                  </span>
                </Notice>
              )}
              <InputBox>
                <InputTop>
                  <span>Amount to stake</span>
                  {connected && (
                    <span>
                      Available: {fmt(available)}
                      <MaxBtn
                        type="button"
                        onClick={() =>
                          setAmount(
                            sdk.formatAmount(spendableRaw, LUNES_DECIMALS)
                          )
                        }
                      >
                        MAX
                      </MaxBtn>
                    </span>
                  )}
                </InputTop>
                <InputRow>
                  <AmountInput
                    value={amount}
                    onChange={onAmount}
                    placeholder="0"
                    inputMode="decimal"
                    aria-label="LUNES amount"
                    data-bare=""
                    disabled={!stakingAvailable || hasPosition}
                  />
                  <LpPill>
                    <img src="/img/lunes-green.svg" alt="" width={24} />
                    LUNES
                  </LpPill>
                </InputRow>
                <SmallLabel>{hint}</SmallLabel>
              </InputBox>
              <SmallLabel>Lock duration</SmallLabel>
              <Durations role="radiogroup" aria-label="Lock duration">
                {STAKE_DURATION_OPTIONS.map((o, i) => (
                  <DurationBtn
                    key={o.days}
                    type="button"
                    role="radio"
                    aria-checked={i === durationIdx}
                    $active={i === durationIdx}
                    disabled={hasPosition}
                    onClick={() => setDurationIdx(i)}
                  >
                    <strong>{o.days}d</strong>
                    <span>
                      {o.tier} · {o.aprBps / 100}%
                    </span>
                  </DurationBtn>
                ))}
              </Durations>
              <SmallLabel>
                Unstaking before the lock ends costs{' '}
                {EARLY_UNSTAKE_PENALTY_BPS / 100}% of the principal. Larger
                stakes earn more (×1.1 from 10k, ×1.2 from 50k, ×1.3 from 200k
                LUNES).
              </SmallLabel>
            </>
          ) : (
            <InputBox>
              <KV>
                <span>Staked</span>
                <span>{fmt(staked)} LUNES</span>
              </KV>
              <KV>
                <span>Pending rewards</span>
                <span>{fmt(rewards)} LUNES</span>
              </KV>
              {locked && (
                <KV>
                  <span>Early unstake penalty</span>
                  <span style={{ color: C.criticalText2 }}>
                    −{fmt(penalty)} LUNES
                  </span>
                </KV>
              )}
              <Divider />
              <KV>
                <span>You receive (est.)</span>
                <span>{fmt(Math.max(0, staked + rewards - penalty))} LUNES</span>
              </KV>
              {locked && position && (
                <Notice $tone="warning" role="alert">
                  <AlertTriangle size={16} />
                  <span>
                    Locked until {fmtDate(position.unlockAt)}. Unstaking now
                    forfeits {EARLY_UNSTAKE_PENALTY_BPS / 100}% of your stake.
                  </span>
                </Notice>
              )}
              <SmallLabel>
                Unstake withdraws the whole position (principal + rewards).
              </SmallLabel>
            </InputBox>
          )}
        </TabPanel>
        <Button
          size="xl"
          block
          disabled={!cta.ok}
          onClick={cta.onClick}
          variant={tab === 'unstake' && locked ? 'danger' : 'primary'}
          style={{ borderRadius: 16 }}
        >
          {cta.label}
        </Button>
      </StakeCard>

      <How>
        <HowTitle>How it works</HowTitle>
        <Steps>
          <StepBox>
            <StepNum>1</StepNum>
            <span>
              Stake at least {fmt(MIN_STAKE_LUNES)} LUNES and pick a lock:
              7d Bronze 8%, 31d Silver 10%, 91d Gold 12%, 181d+ Platinum 15%.
            </span>
          </StepBox>
          <StepBox>
            <StepNum>2</StepNum>
            <span>
              Rewards accrue in LUNES. Claim any time; unstake after the lock
              to avoid the 5% penalty.
            </span>
          </StepBox>
          <StepLink type="button" onClick={() => navigate('/governance')}>
            <StepNum>3</StepNum>
            <span>
              Your stake is your voting power in governance{' '}
              <ArrowRight size={13} color={C.primaryText} />
            </span>
          </StepLink>
        </Steps>
      </How>
    </Page>
  )
}

export default Staking

// ─── Styles ──────────────────────────────────────────────────────

const Stats = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
`

const Stat = styled.div<{ $accent?: boolean }>`
  padding: 14px;
  border-radius: 14px;
  background: ${p => (p.$accent ? C.primary : C.surface)};
  border: 1px solid ${p => (p.$accent ? C.primary : C.border)};
  min-width: 0;
  > span {
    display: block;
    font-size: 12px;
    color: ${p => (p.$accent ? C.primaryText2 : C.muted)};
    margin-bottom: 4px;
  }
  > strong {
    display: block;
    ${grotesk};
    ${tabular};
    font-size: clamp(17px, 2.6vw, 22px);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`

const Position = styled.div`
  border: 1px solid ${C.border};
  border-radius: 16px;
  padding: 16px;
  background: ${C.surface};
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const PositionHead = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
`

const SmallLabel = styled.span`
  font-size: 12px;
  color: ${C.muted};
`

const Rewards = styled.span`
  ${grotesk};
  ${tabular};
  font-size: 24px;
  font-weight: 600;
  color: ${C.success};
`

const StakeCard = styled(MainCard)`
  background: ${C.bg};
`

const InputBox = styled(Panel)`
  background: ${C.surface};
  &:focus-within {
    border-color: ${C.primary};
    box-shadow: 0 0 0 3px ${tint.primary.bg};
  }
`

const InputTop = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: ${C.muted};
  gap: 8px;
  > span:last-child {
    display: flex;
    align-items: center;
    gap: 8px;
    ${tabular};
  }
`

const MaxBtn = styled.button`
  height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  border: none;
  background: ${C.primary};
  color: ${C.text};
  font-size: 12px;
  font-weight: 600;
  &:hover {
    background: ${C.primaryHover};
  }
`

const InputRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const AmountInput = styled.input`
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: ${C.text};
  ${grotesk};
  ${tabular};
  font-size: 28px;
  font-weight: 500;
  padding: 0;
  &::placeholder {
    color: ${C.muted};
  }
`

const LpPill = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 42px;
  padding: 0 12px 0 6px;
  border-radius: 999px;
  background: ${C.field};
  ${grotesk};
  font-weight: 600;
  font-size: 14px;
  flex-shrink: 0;
`

const How = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 8px;
`

const HowTitle = styled.div`
  ${grotesk};
  font-weight: 600;
  font-size: 16px;
`

const Steps = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
`

const stepCss = css`
  text-align: left;
  font-family: 'Inter', sans-serif;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid ${C.border};
  background: transparent;
  color: ${C.text};
  display: flex;
  flex-direction: column;
  gap: 6px;
  > span:last-child {
    font-size: 13px;
    line-height: 1.5;
  }
`

const StepBox = styled.div`
  ${stepCss};
`

const StepLink = styled.button`
  white-space: normal;
  ${stepCss};
  cursor: pointer;
  transition: border-color 150ms ease;
  svg {
    vertical-align: -2px;
  }
  &:hover {
    border-color: ${C.primary};
  }
`

const StepNum = styled.span`
  ${grotesk};
  color: ${C.primaryText};
  font-weight: 700;
`

const Durations = styled.div`
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
  @media (max-width: 480px) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
`

const DurationBtn = styled.button<{ $active: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 4px;
  border-radius: 12px;
  border: 1px solid ${p => (p.$active ? C.primary : C.border)};
  background: ${p => (p.$active ? tint.primary.bg : C.surface)};
  color: ${C.text};
  cursor: pointer;
  > strong {
    ${grotesk};
    ${tabular};
    font-size: 15px;
  }
  > span {
    font-size: 11px;
    color: ${C.muted};
    white-space: nowrap;
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`
