import React, { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ChevronRight, Info, Zap } from 'lucide-react'
import {
  C,
  Page,
  MainCard,
  Button,
  Tabs,
  TabPanel,
  Notice,
  LinkButton,
  grotesk,
  tabular
} from '../../components/ui/kit'
import TokenIcon from '../../components/TokenIcon'
import { useTx, TxStep } from '../../context/TxContext'
import { useSDK } from '../../context/SDKContext'
import useLiquidity, { LP_DECIMALS } from '../../hooks/useLiquidity'
import {
  usePools,
  LIQUIDITY_TOKENS,
  KnownToken,
  Pool as PoolModel
} from '../../hooks/usePools'
import {
  TokenSelectModal,
  Token as SelectToken
} from '../../components/TokenSelect'
import { openWalletModal } from '../header/modals/wallets'
import { cleanAmount, fmt, fromUnits, usd, usdFull } from './format'

type LiqTab = 'add' | 'remove'

// ─── Styled ─────────────────────────────────────────────────────

const Back = styled(LinkButton)`
  align-self: flex-start;
  color: ${C.muted};
  font-size: 14px;
  font-weight: 500;
  padding: 4px 0;
  &:hover {
    color: #fff;
  }
`

const ProBanner = styled.button`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid ${C.primaryBorder};
  background: rgba(108, 56, 255, 0.1);
  color: #fff;
  text-align: left;
  transition: background-color 150ms ease;
  &:hover {
    background: rgba(108, 56, 255, 0.18);
  }
  > span {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  b {
    ${grotesk};
    display: block;
    font-weight: 600;
    font-size: 14px;
  }
  small {
    display: block;
    font-size: 12px;
    color: ${C.secondary};
    margin-top: 2px;
  }
`

const Box = styled.div<{ $error?: boolean }>`
  background: ${C.surface};
  border: 1px solid ${p => (p.$error ? 'rgba(255,93,105,0.6)' : C.border)};
  border-radius: 16px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease;
  &:focus-within {
    border-color: ${C.primary};
    box-shadow: 0 0 0 3px rgba(108, 56, 255, 0.25);
  }
`

const BoxHead = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
  color: ${C.muted};
  ${tabular};
`

const AmountRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const AmountInput = styled.input`
  ${grotesk};
  ${tabular};
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: #fff;
  font-size: 28px;
  font-weight: 500;
  padding: 0;
  &::placeholder {
    color: #6d6d6d;
  }
  @media (max-width: 759px) {
    font-size: 24px;
  }
`

const AmountRead = styled.div<{ $empty: boolean }>`
  ${grotesk};
  ${tabular};
  flex: 1;
  min-width: 0;
  font-size: 28px;
  font-weight: 500;
  color: ${p => (p.$empty ? '#6d6d6d' : '#fff')};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  @media (max-width: 759px) {
    font-size: 24px;
  }
`

const TokenBtn = styled.button`
  ${grotesk};
  display: flex;
  align-items: center;
  gap: 8px;
  height: 42px;
  padding: 0 10px 0 6px;
  border-radius: 999px;
  background: ${C.field};
  border: 1px solid ${C.borderStrong};
  color: #fff;
  font-weight: 600;
  font-size: 16px;
  flex-shrink: 0;
  &:hover {
    border-color: ${C.primary};
  }
`

const Hint = styled.div`
  font-size: 12px;
  color: ${C.muted};
  ${tabular};
`

const Preview = styled.div`
  border: 1px solid ${C.border};
  border-radius: 16px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  > b {
    ${grotesk};
    font-weight: 600;
    font-size: 14px;
    margin-bottom: 6px;
  }
`

const PRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 5px 0;
  font-size: 13px;
  > span:first-child {
    color: ${C.muted};
    display: flex;
    align-items: center;
    gap: 8px;
  }
  > span:last-child {
    font-weight: 500;
    text-align: right;
    ${tabular};
  }
`

const SigNote = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: ${C.muted};
`

const PosBtn = styled.button<{ $on: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid ${p => (p.$on ? C.primary : C.border)};
  background: ${p => (p.$on ? 'rgba(108,56,255,0.1)' : C.surface)};
  color: #fff;
  text-align: left;
  > div {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  b {
    ${grotesk};
    font-weight: 600;
  }
  small {
    font-size: 12px;
    color: ${C.muted};
    ${tabular};
  }
  > span {
    ${grotesk};
    ${tabular};
    font-weight: 600;
  }
`

const Pair = styled.span`
  display: flex;
  flex-shrink: 0;
  img + img {
    margin-left: -8px;
    border: 2px solid ${C.surface};
    box-sizing: content-box;
  }
`

const Pct = styled.span`
  ${grotesk};
  ${tabular};
  font-size: 36px;
  font-weight: 600;
`

const Range = styled.input`
  width: 100%;
  accent-color: ${C.primary};
`

const PctChip = styled.button<{ $on: boolean }>`
  ${grotesk};
  flex: 1;
  height: 36px;
  border-radius: 10px;
  border: none;
  background: ${p => (p.$on ? C.primary : C.field)};
  color: #fff;
  font-weight: 600;
  font-size: 13px;
`

const Dashed = styled.div`
  padding: 36px 20px;
  border-radius: 16px;
  border: 1px dashed ${C.borderStrong};
  text-align: center;
  font-size: 14px;
  color: ${C.muted};
  line-height: 1.5;
`

// ─── Helpers ────────────────────────────────────────────────────

const bySymbol = (sym?: string | null): KnownToken | undefined =>
  sym
    ? LIQUIDITY_TOKENS.find(t => t.symbol.toLowerCase() === sym.toLowerCase())
    : undefined

// Liquidity tokens in the shared TokenSelectModal shape
const SELECT_TOKENS: SelectToken[] = LIQUIDITY_TOKENS.map((t, i) => ({
  id: i,
  icon: t.icon,
  acronym: t.symbol,
  token: t.name,
  tokenPrice: '',
  address: t.address,
  decimals: t.decimals
}))
const toSelect = (t?: { symbol: string } | null) =>
  t ? (SELECT_TOKENS.find(x => x.acronym === t.symbol) ?? null) : null

const toBig = (v: string | undefined | null) => {
  try {
    return BigInt(v || '0')
  } catch {
    return BigInt(0)
  }
}

const shareLabel = (s: number) => (s > 0 && s < 0.01 ? '<0.01' : s.toFixed(2))

// ─── Page ───────────────────────────────────────────────────────

const Pool: React.FC = () => {
  const sdk = useSDK()
  const tx = useTx()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const liquidity = useLiquidity()
  const { pools, positions, prices, refreshPools, refreshPositions } =
    usePools()

  const [tab, setTab] = useState<LiqTab>(
    params.get('tab') === 'remove' ? 'remove' : 'add'
  )
  const [picker, setPicker] = useState<'A' | 'B' | null>(null)
  const [balA, setBalA] = useState<number | null>(null)
  const [balB, setBalB] = useState<number | null>(null)
  const [approvals, setApprovals] = useState<KnownToken[] | null>(null)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [removePct, setRemovePct] = useState(50)
  const [balTick, setBalTick] = useState(0)

  const { tokenA, tokenB, amountA, amountB, poolInfo, isNewPool } = liquidity
  const connected = !!sdk.walletAddress

  // Initial pair from the URL (?a=SYM&b=SYM), default WLUNES / LUSDT
  useEffect(() => {
    const a = bySymbol(params.get('a')) ?? bySymbol('WLUNES')
    const b = bySymbol(params.get('b')) ?? bySymbol('LUSDT')
    if (a) liquidity.setTokenA(a)
    if (b && b.symbol !== a?.symbol) liquidity.setTokenB(b)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Wallet balances of the selected tokens
  useEffect(() => {
    const w = sdk.walletAddress
    const load = (t: KnownToken | null, set: (v: number | null) => void) => {
      if (!w || !t) return set(null)
      sdk
        .getTokenBalance(t.address, w)
        .then(raw => set(fromUnits(raw, t.decimals)))
        .catch(() => set(null))
    }
    load(tokenA as KnownToken | null, setBalA)
    load(tokenB as KnownToken | null, setBalB)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenA, tokenB, sdk.walletAddress, balTick])

  const amtA = parseFloat(amountA) || 0
  const amtB = parseFloat(amountB) || 0

  // Which approvals the deposit needs (drives the signature note)
  useEffect(() => {
    if (!connected || amtA <= 0 || amtB <= 0) {
      setApprovals(null)
      return
    }
    let alive = true
    const t = setTimeout(() => {
      liquidity.getMissingApprovals().then(list => {
        if (alive) setApprovals(list as KnownToken[])
      })
    }, 350)
    return () => {
      alive = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, amountA, amountB, tokenA, tokenB])

  const poolFor = (addr?: string) =>
    addr ? pools.find(p => p.pairAddress === addr) : undefined
  const currentPool = poolFor(poolInfo?.pairAddress)

  const pickToken = (t: KnownToken) => {
    if (picker === 'A') {
      if (tokenB && t.symbol === tokenB.symbol) liquidity.setTokenB(tokenA)
      liquidity.setTokenA(t)
    } else if (picker === 'B') {
      if (tokenA && t.symbol === tokenA.symbol) liquidity.setTokenA(tokenB)
      liquidity.setTokenB(t)
    }
    liquidity.setAmountA('')
    liquidity.setAmountB('')
    setPicker(null)
  }

  const priceA = tokenA ? prices[tokenA.symbol] : undefined
  const priceB = tokenB ? prices[tokenB.symbol] : undefined

  // ── Add: preview ─────────────────────────────────────────────
  const preview = useMemo(() => {
    if (!tokenA || !tokenB) return null
    const aWei = toBig(sdk.parseAmount(amountA || '0', tokenA.decimals))
    const bWei = toBig(sdk.parseAmount(amountB || '0', tokenB.decimals))
    let rate: number | null = null
    let share = 0
    let lp = 0
    if (poolInfo && !isNewPool) {
      rate = poolInfo.rate
      const rA = toBig(poolInfo.reserveA)
      const supply = toBig(poolInfo.totalSupply)
      if (aWei > BigInt(0) && rA > BigInt(0)) {
        share = (Number(aWei) / Number(rA + aWei)) * 100
        lp = fromUnits((aWei * supply) / rA, LP_DECIMALS)
      }
    } else {
      rate = amtA > 0 && amtB > 0 ? amtB / amtA : null
      share = amtA > 0 ? 100 : 0
      if (aWei > BigInt(0) && bWei > BigInt(0)) {
        // first deposit: sqrt(a·b) minus the locked minimum liquidity
        lp = Math.max(0, Math.sqrt(Number(aWei) * Number(bWei)) - 1000)
        lp = lp / Math.pow(10, LP_DECIMALS)
      }
    }
    return { rate, share, lp }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenA, tokenB, amountA, amountB, poolInfo, isNewPool])

  // ── Add: CTA ─────────────────────────────────────────────────
  const runAdd = async () => {
    if (!tokenA || !tokenB) return
    const need = (await liquidity.getMissingApprovals()) as KnownToken[]
    const a = tokenA.symbol
    const b = tokenB.symbol
    const summary = `${fmt(amtA)} ${a} + ${fmt(amtB)} ${b}`
    const steps: TxStep[] = [
      ...need.map(t => ({
        label: `Approve ${t.symbol} spending`,
        wallet: true,
        run: () =>
          liquidity.approve(
            t.address,
            sdk.parseAmount(t.symbol === a ? amountA : amountB, t.decimals),
            t.symbol
          )
      })),
      {
        label: 'Sign deposit in your wallet',
        wallet: true,
        run: () => liquidity.addLiquidity()
      },
      { label: 'Waiting for block confirmation' }
    ]
    tx.run({
      type: 'liquidity',
      title: 'Adding liquidity',
      summary,
      actTitle: `Add liquidity · ${a}/${b}`,
      successTitle: 'Liquidity added',
      steps,
      onSuccess: () => {
        setBalTick(x => x + 1)
        refreshPools()
      }
    })
  }

  let addCta: { label: string; on?: () => void; ok: boolean }
  if (!connected)
    addCta = { label: 'Connect wallet', ok: true, on: openWalletModal }
  else if (!tokenA || !tokenB) addCta = { label: 'Select a token', ok: false }
  else if (amtA <= 0) addCta = { label: 'Enter an amount', ok: false }
  else if (isNewPool && amtB <= 0)
    addCta = { label: 'Enter the paired amount', ok: false }
  else if (!isNewPool && !poolInfo)
    addCta = { label: 'Loading pool…', ok: false }
  else if (balA !== null && amtA > balA)
    addCta = { label: `Insufficient ${tokenA.symbol} balance`, ok: false }
  else if (balB !== null && amtB > balB)
    addCta = { label: `Insufficient ${tokenB.symbol} balance`, ok: false }
  else
    addCta = {
      label: isNewPool ? 'Create pool & add liquidity' : 'Add liquidity',
      ok: true,
      on: runAdd
    }

  const sigList = approvals ?? []
  const sigN = sigList.length + 1
  const sigNote =
    `${sigN} wallet signature${sigN > 1 ? 's' : ''}: ` +
    [...sigList.map(t => 'approve ' + t.symbol), 'deposit'].join(' · ')

  // ── Remove ───────────────────────────────────────────────────
  const myPos = useMemo(
    () =>
      Object.values(positions)
        .map(p => ({ pos: p, pool: poolFor(p.pairAddress) }))
        .filter((x): x is { pos: typeof x.pos; pool: PoolModel } => !!x.pool),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [positions, pools]
  )

  // Preselect the pair from the URL, else the first position
  useEffect(() => {
    if (myPos.length === 0) return
    if (removeId && myPos.some(x => x.pos.pairAddress === removeId)) return
    const a = params.get('a')
    const b = params.get('b')
    const pair = params.get('pair')
    const fromUrl = myPos.find(
      x =>
        x.pos.pairAddress === pair ||
        (x.pool.token0.symbol === a && x.pool.token1.symbol === b) ||
        (x.pool.token0.symbol === b && x.pool.token1.symbol === a)
    )
    setRemoveId((fromUrl ?? myPos[0]).pos.pairAddress)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myPos])

  const sel = myPos.find(x => x.pos.pairAddress === removeId)

  // The remove flow needs useLiquidity on the selected pair
  useEffect(() => {
    if (tab !== 'remove' || !sel) return
    const t0 = sel.pool.token0
    const t1 = sel.pool.token1
    if (tokenA?.address !== t0.address || tokenB?.address !== t1.address) {
      liquidity.setTokenA(t0)
      liquidity.setTokenB(t1)
      liquidity.setAmountA('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, sel?.pos.pairAddress])

  const removeLp = sel
    ? (toBig(sel.pos.lpBalance) * BigInt(removePct)) / BigInt(100)
    : BigInt(0)
  const receive = sel
    ? (() => {
        const supply = toBig(sel.pool.totalSupply)
        if (supply <= BigInt(0)) return [0, 0]
        return [
          fromUnits(
            (removeLp * toBig(sel.pool.reserve0)) / supply,
            sel.pool.token0.decimals
          ),
          fromUnits(
            (removeLp * toBig(sel.pool.reserve1)) / supply,
            sel.pool.token1.decimals
          )
        ]
      })()
    : [0, 0]

  const runRemove = async () => {
    if (!sel) return
    const lp = removeLp.toString()
    const pair = `${sel.pool.token0.symbol}/${sel.pool.token1.symbol}`
    const pct = removePct
    const needLp = await liquidity.needsLpApproval(lp)
    const steps: TxStep[] = [
      ...(needLp
        ? [
            {
              label: 'Approve LP token spending',
              wallet: true,
              run: () => liquidity.approve(sel.pool.pairAddress, lp, 'LP token')
            }
          ]
        : []),
      {
        label: 'Sign withdrawal in your wallet',
        wallet: true,
        run: () => liquidity.removeLiquidity(lp)
      },
      { label: 'Waiting for block confirmation' }
    ]
    tx.run({
      type: 'liquidity',
      title: 'Removing liquidity',
      summary: `${pct}% of ${pair}`,
      actTitle: `Remove ${pct}% · ${pair}`,
      successTitle: 'Liquidity removed',
      steps,
      onSuccess: () => {
        setBalTick(x => x + 1)
        refreshPools()
        refreshPositions()
      }
    })
  }

  let removeCta: { label: string; on?: () => void; ok: boolean }
  if (!connected)
    removeCta = {
      label: 'Connect wallet',
      ok: true,
      on: openWalletModal
    }
  else if (!sel) removeCta = { label: 'No positions to remove', ok: false }
  else if (
    poolInfo?.pairAddress !== sel.pos.pairAddress ||
    removeLp <= BigInt(0)
  )
    removeCta = { label: 'Loading position…', ok: false }
  else removeCta = { label: 'Remove liquidity', ok: true, on: runRemove }

  const tokenButton = (t: KnownToken | null, side: 'A' | 'B') => (
    <TokenBtn
      onClick={() => setPicker(side)}
      aria-label={`Select token ${side === 'A' ? 'to deposit' : 'to pair'}`}
    >
      {t ? (
        <>
          <TokenIcon address={t.address} symbol={t.symbol} size={28} />
          {t.symbol}
        </>
      ) : (
        <span style={{ paddingLeft: 6 }}>Select</span>
      )}
      <ChevronDown size={16} color={C.muted} strokeWidth={2} />
    </TokenBtn>
  )

  return (
    <Page $max={520} style={{ gap: 12 }}>
      <Back onClick={() => navigate('/pools')}>
        <ArrowLeft size={16} strokeWidth={2} />
        All pools
      </Back>

      <MainCard style={{ background: C.bg }}>
        <ProBanner onClick={() => navigate('/pool/asymmetric')}>
          <span>
            <Zap size={18} color={C.primaryText2} strokeWidth={1.75} />
            <span>
              <b>Asymmetric liquidity — Pro mode</b>
              <small>Parametric curves, templates and AI delegation</small>
            </span>
          </span>
          <ChevronRight size={18} color={C.primaryText2} />
        </ProBanner>

        <Tabs<LiqTab>
          block
          ariaLabel="Liquidity action"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'add', label: 'Add' },
            { value: 'remove', label: 'Remove' }
          ]}
        />

        {tab === 'add' ? (
          <TabPanel key="add">
            <Box $error={connected && balA !== null && amtA > balA}>
              <BoxHead>
                <span>Deposit</span>
                {connected && balA !== null && (
                  <span
                    style={{ color: amtA > balA ? C.criticalText : C.muted }}
                  >
                    Balance: {fmt(balA)}
                  </span>
                )}
              </BoxHead>
              <AmountRow>
                <AmountInput
                  value={amountA}
                  onChange={e =>
                    liquidity.setAmountA(cleanAmount(e.target.value))
                  }
                  placeholder="0"
                  inputMode="decimal"
                  aria-label="Deposit amount"
                  data-bare=""
                />
                {tokenButton(tokenA as KnownToken | null, 'A')}
              </AmountRow>
              <Hint>
                {amtA > 0 && priceA
                  ? '≈ ' + usdFull(amtA * priceA)
                  : 'Enter the amount of the first token'}
              </Hint>
            </Box>

            <Box $error={connected && balB !== null && amtB > balB}>
              <BoxHead>
                <span>
                  {isNewPool
                    ? 'Paired amount (sets the starting price)'
                    : 'Paired amount (set by pool price)'}
                </span>
                {connected && balB !== null && (
                  <span
                    style={{ color: amtB > balB ? C.criticalText : C.muted }}
                  >
                    Balance: {fmt(balB)}
                  </span>
                )}
              </BoxHead>
              <AmountRow>
                {isNewPool ? (
                  <AmountInput
                    value={amountB}
                    onChange={e =>
                      liquidity.setAmountB(cleanAmount(e.target.value))
                    }
                    placeholder="0"
                    inputMode="decimal"
                    aria-label="Paired amount"
                    data-bare=""
                  />
                ) : (
                  <AmountRead $empty={amtB <= 0} aria-live="polite">
                    {amtB > 0 ? fmt(amtB) : '0'}
                  </AmountRead>
                )}
                {tokenButton(tokenB as KnownToken | null, 'B')}
              </AmountRow>
              <Hint>
                {amtB > 0 && priceB
                  ? '≈ ' + usdFull(amtB * priceB)
                  : isNewPool
                    ? 'You choose the starting ratio'
                    : 'Calculated automatically'}
              </Hint>
            </Box>

            {isNewPool && tokenA && tokenB && (
              <Notice $tone="primary">
                No pool exists for this pair yet. You will be the first provider
                and your deposit sets the starting price.
              </Notice>
            )}
            {liquidity.error && !isNewPool && !poolInfo && (
              <Notice $tone="critical">{liquidity.error}</Notice>
            )}

            <Preview>
              <b>Position preview</b>
              <PRow>
                <span>Rate</span>
                <span>
                  {tokenA && tokenB && preview?.rate
                    ? `1 ${tokenA.symbol} = ${fmt(preview.rate)} ${tokenB.symbol}`
                    : '—'}
                </span>
              </PRow>
              <PRow>
                <span>Share of pool</span>
                <span>
                  {amtA > 0 && preview ? shareLabel(preview.share) + '%' : '—'}
                </span>
              </PRow>
              <PRow>
                <span>LP tokens received</span>
                <span>
                  {amtA > 0 && preview && preview.lp > 0
                    ? '≈ ' + fmt(preview.lp)
                    : '—'}
                </span>
              </PRow>
              <PRow>
                <span>Pool APR</span>
                <span
                  style={{
                    color: currentPool && !isNewPool ? C.success : '#fff'
                  }}
                >
                  {isNewPool
                    ? 'New pool'
                    : currentPool
                      ? currentPool.apr.toFixed(1) + '%'
                      : '—'}
                </span>
              </PRow>
            </Preview>

            {connected && amtA > 0 && approvals !== null && (
              <SigNote>
                <Info size={14} strokeWidth={2} />
                {sigNote}
              </SigNote>
            )}

            <Button size="xl" block disabled={!addCta.ok} onClick={addCta.on}>
              {addCta.label}
            </Button>
          </TabPanel>
        ) : (
          <TabPanel key="remove">
            {connected && sel ? (
              <>
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                >
                  <span style={{ fontSize: 13, color: C.muted }}>
                    Your positions
                  </span>
                  {myPos.map(({ pos, pool }) => (
                    <PosBtn
                      key={pos.pairAddress}
                      $on={pos.pairAddress === sel.pos.pairAddress}
                      aria-pressed={pos.pairAddress === sel.pos.pairAddress}
                      onClick={() => setRemoveId(pos.pairAddress)}
                    >
                      <Pair>
                        <TokenIcon
                          address={pool.token0.address}
                          symbol={pool.token0.symbol}
                          size={28}
                        />
                        <TokenIcon
                          address={pool.token1.address}
                          symbol={pool.token1.symbol}
                          size={28}
                        />
                      </Pair>
                      <div>
                        <b>
                          {pool.token0.symbol} / {pool.token1.symbol}
                        </b>
                        <small>
                          {fmt(fromUnits(pos.lpBalance, LP_DECIMALS))} LP ·{' '}
                          {shareLabel(pos.share)}% of pool
                        </small>
                      </div>
                      <span>
                        {pool.liquidity > 0 ? usd(pos.valueUsd) : '—'}
                      </span>
                    </PosBtn>
                  ))}
                </div>

                <Box>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline'
                    }}
                  >
                    <span style={{ fontSize: 13, color: C.muted }}>
                      Amount to remove
                    </span>
                    <Pct>{removePct}%</Pct>
                  </div>
                  <Range
                    type="range"
                    min={1}
                    max={100}
                    step={1}
                    value={removePct}
                    onChange={e => setRemovePct(+e.target.value)}
                    aria-label="Percentage to remove"
                  />
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[25, 50, 75, 100].map(v => (
                      <PctChip
                        key={v}
                        $on={removePct === v}
                        onClick={() => setRemovePct(v)}
                      >
                        {v === 100 ? 'Max' : v + '%'}
                      </PctChip>
                    ))}
                  </div>
                </Box>

                <Preview>
                  <b>You will receive</b>
                  {[sel.pool.token0, sel.pool.token1].map((t, i) => (
                    <PRow key={t.address} style={{ fontSize: 14 }}>
                      <span style={{ color: '#fff' }}>
                        <TokenIcon
                          address={t.address}
                          symbol={t.symbol}
                          size={20}
                        />
                        {t.symbol}
                      </span>
                      <span>{fmt(receive[i])}</span>
                    </PRow>
                  ))}
                </Preview>
              </>
            ) : (
              <Dashed>
                {connected
                  ? 'You have no liquidity positions yet.'
                  : 'Connect your wallet to see the positions you can withdraw.'}
              </Dashed>
            )}
            <Button
              size="xl"
              block
              disabled={!removeCta.ok}
              onClick={removeCta.on}
            >
              {removeCta.label}
            </Button>
          </TabPanel>
        )}
      </MainCard>

      <TokenSelectModal
        open={picker !== null}
        onClose={() => setPicker(null)}
        onSelect={t => {
          const k = bySymbol(t.acronym)
          if (k) pickToken(k)
        }}
        selected={toSelect(picker === 'A' ? tokenA : tokenB)}
        other={toSelect(picker === 'A' ? tokenB : tokenA)}
        tokens={SELECT_TOKENS}
        prices={prices}
      />
    </Page>
  )
}

export default Pool
