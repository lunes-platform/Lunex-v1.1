import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled, { css } from 'styled-components'
import { ArrowRight, Clock } from 'lucide-react'
import { useSDK } from '../../context/SDKContext'
import { useTx } from '../../context/TxContext'
import { CONTRACTS, TOKENS } from '../../config/contracts'
import {
  Button,
  C,
  Divider,
  H1,
  KV,
  MainCard,
  Notice,
  Page,
  PairIcons,
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

// The staking contract is optional until deployed on the target network.
const stakingAvailable = CONTRACTS.STAKING.length >= 10
const LP_DECIMALS = 8
const DEFAULT_LOCK_DAYS = 7

type StakingInfo = {
  totalStaked: string
  userStaked: string
  pendingRewards: string
  apr: string
  lockPeriod: number
}

type StakeTab = 'stake' | 'unstake'

const fmt = (v: number, max = 4) =>
  v.toLocaleString('en-US', { maximumFractionDigits: max })

const Staking: React.FC = () => {
  const sdk = useSDK()
  const tx = useTx()
  const navigate = useNavigate()

  const [info, setInfo] = useState<StakingInfo | null>(null)
  const [lpBalance, setLpBalance] = useState('0')
  const [tab, setTab] = useState<StakeTab>('stake')
  const [amount, setAmount] = useState('')

  const fetchLpBalance = useCallback(async () => {
    if (!sdk.walletAddress || !sdk.isConnected) return
    try {
      const pair = await sdk.getPairInfo(TOKENS.WLUNES, TOKENS.LUSDT)
      if (pair?.address) {
        const bal = await sdk.getTokenBalance(pair.address, sdk.walletAddress)
        setLpBalance(sdk.formatAmount(bal, LP_DECIMALS))
      }
    } catch (err: unknown) {
      console.error('Error fetching LP balance:', err)
    }
  }, [sdk])

  const refresh = useCallback(async () => {
    if (!sdk.walletAddress) return
    await fetchLpBalance()
    if (!stakingAvailable) return
    const userInfo = await sdk.getStakingUserInfo(sdk.walletAddress)
    if (userInfo) setInfo(userInfo)
  }, [sdk, fetchLpBalance])

  useEffect(() => {
    refresh()
  }, [refresh])

  const toNum = (raw?: string) =>
    raw ? Number(sdk.formatAmount(raw, LP_DECIMALS)) || 0 : 0

  const totalStaked = toNum(info?.totalStaked)
  const staked = toNum(info?.userStaked)
  const rewards = toNum(info?.pendingRewards)
  const available = Number(lpBalance) || 0
  const apr = Number(info?.apr) || 0
  const lockDays = info?.lockPeriod || DEFAULT_LOCK_DAYS
  const connected = sdk.isConnected

  const amt = Number(amount) || 0
  const maxV = tab === 'stake' ? available : staked

  const switchTab = (t: StakeTab) => {
    setTab(t)
    setAmount('')
  }

  const onAmount = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.replace(',', '.')
    if (v === '' || /^\d*\.?\d{0,8}$/.test(v)) setAmount(v)
  }

  const runStake = () => {
    const isStake = tab === 'stake'
    const value = amount
    const label = fmt(amt)
    tx.run({
      type: 'staking',
      title: isStake ? 'Staking' : 'Unstaking',
      summary: `${label} WLUNES/LUSDT LP`,
      actTitle: `${isStake ? 'Stake' : 'Unstake'} ${label} LP`,
      successTitle: isStake ? 'LP staked' : 'LP unstaked',
      errorText: isStake
        ? 'The stake did not complete.'
        : 'The unstake did not complete.',
      steps: [
        {
          label: `Sign ${isStake ? 'stake' : 'unstake'} in your wallet`,
          wallet: true,
          run: ({ advance }) => {
            const raw = sdk.parseAmount(value, LP_DECIMALS)
            const p = isStake ? sdk.stake(raw) : sdk.unstake(raw)
            return p.then(ok => {
              if (ok) advance()
              return ok
            })
          }
        },
        { label: 'Waiting for block confirmation' }
      ],
      onSuccess: () => {
        setAmount('')
        refresh()
      }
    })
  }

  const runClaim = () => {
    if (rewards <= 0) return
    const label = fmt(rewards)
    tx.run({
      type: 'staking',
      title: 'Claiming rewards',
      summary: `${label} WLUNES`,
      actTitle: `Claim ${label} WLUNES`,
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
        { label: 'Waiting for block confirmation' }
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
  } else if (amt <= 0) {
    cta = { label: 'Enter an amount', ok: false }
  } else if (amt > maxV + 1e-9) {
    cta = {
      label:
        tab === 'stake' ? 'Insufficient LP balance' : 'Exceeds staked amount',
      ok: false
    }
  } else {
    cta = {
      label: tab === 'stake' ? 'Stake LP' : 'Unstake LP',
      onClick: runStake,
      ok: true
    }
  }

  const hint =
    amt > 0
      ? `${fmt(amt)} LP${tab === 'stake' ? ` · locked for ${lockDays} days` : ''}`
      : tab === 'stake'
        ? 'WLUNES/LUSDT LP tokens'
        : 'Only unlocked LP can be withdrawn'

  // PLACEHOLDER: no backend yet — the staking contract does not expose
  // per-stake unlock timestamps, so we only describe the lock rule.
  const nextUnlock = staked > 0 ? `${lockDays} days after each stake` : '—'

  return (
    <Page $max={560}>
      <div>
        <H1>Staking</H1>
        <Sub>Stake WLUNES/LUSDT LP tokens and earn WLUNES every block.</Sub>
      </div>

      {!stakingAvailable && (
        <Notice $tone="primary" role="status">
          <Clock size={16} />
          <span>
            Staking opens once the contract is deployed on Lunes. Until then you
            can add liquidity to get LP tokens ready to stake.
          </span>
        </Notice>
      )}

      <Stats>
        <Stat>
          <span>Total staked</span>
          <strong>
            <AnimatedNumber text={`${fmt(totalStaked, 2)} LP`} />
          </strong>
        </Stat>
        <Stat $accent>
          <span>APR</span>
          <strong>
            <AnimatedNumber text={`${fmt(apr, 2)}%`} />
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
                <AnimatedNumber text={`${fmt(rewards)} WLUNES`} />
              </Rewards>
              <SmallLabel>Accrues every block</SmallLabel>
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
              <AnimatedNumber text={`${fmt(staked)} LP`} />
            </span>
          </KV>
          <KV>
            <span>Available to stake</span>
            <span>
              <AnimatedNumber text={`${fmt(available)} LP`} />
            </span>
          </KV>
          <KV>
            <span>Next unlock</span>
            <span>{nextUnlock}</span>
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
          <InputBox>
            <InputTop>
              <span>
                {tab === 'stake' ? 'Amount to stake' : 'Amount to unstake'}
              </span>
              {connected && (
                <span>
                  {tab === 'stake'
                    ? `Available: ${fmt(available)}`
                    : `Staked: ${fmt(staked)}`}
                  <MaxBtn
                    type="button"
                    onClick={() =>
                      setAmount(tab === 'stake' ? lpBalance : String(staked))
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
                aria-label="LP amount"
                data-bare=""
                disabled={!stakingAvailable}
              />
              <LpPill>
                <PairIcons $size={24}>
                  <img src="/img/lunes-green.svg" alt="" />
                  <img src="/img/lusdt.png" alt="" />
                </PairIcons>
                LP
              </LpPill>
            </InputRow>
            <SmallLabel>{hint}</SmallLabel>
          </InputBox>
        </TabPanel>
        <Button
          size="xl"
          block
          disabled={!cta.ok}
          onClick={cta.onClick}
          style={{ borderRadius: 16 }}
        >
          {cta.label}
        </Button>
      </StakeCard>

      <How>
        <HowTitle>How it works</HowTitle>
        <Steps>
          <StepLink type="button" onClick={() => navigate('/pool')}>
            <StepNum>1</StepNum>
            <span>
              Add liquidity to WLUNES/LUSDT to get LP tokens{' '}
              <ArrowRight size={13} color={C.primaryText} />
            </span>
          </StepLink>
          <StepBox>
            <StepNum>2</StepNum>
            <span>
              Stake LP here. Each stake is locked for {lockDays} days.
            </span>
          </StepBox>
          <StepBox>
            <StepNum>3</StepNum>
            <span>Rewards accrue every block. Claim any time.</span>
          </StepBox>
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
