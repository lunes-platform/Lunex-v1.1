/**
 * TokenSelectModal — shared token picker (swap, liquidity, pools).
 *
 * Token shape (`Token` from `./tokens`, identical to `Option` in
 * `context/useContext`):
 *   {
 *     id: number          // stable id, used for identity
 *     icon: string        // '/img/…' path ('' → identicon via TokenIcon)
 *     acronym: string     // symbol, e.g. 'WLUNES'
 *     token: string       // display name, e.g. 'Wrapped Lunes'
 *     tokenPrice: string  // static display fallback, e.g. '$ 1.00'
 *     address: string     // PSP22 contract address
 *     decimals: number
 *     isNative?: boolean
 *   }
 *
 * Usage:
 *   <TokenSelectModal
 *     open={side !== null}
 *     onClose={() => setSide(null)}
 *     selected={side === 'a' ? tokenA : tokenB}  // marked "selected", dimmed
 *     other={side === 'a' ? tokenB : tokenA}     // marked "other side"
 *     onSelect={t => …}   // the caller swaps sides when t is `other`
 *   />
 *
 * Optional: `tokens` (defaults to the swap list), `balances` / `prices` to
 * reuse data the caller already loaded (otherwise fetched while open).
 */
import React, { useMemo, useState } from 'react'
import styled from 'styled-components'
import { Search } from 'lucide-react'
import { Dialog } from 'components/ui/Dialog'
import { C, grotesk, tabular } from 'components/ui/kit'
import { useSDK } from 'context/SDKContext'
import { getTokenLogo, generateIdenticon } from 'utils/getTokenLogo'
import TOKENS, { Token } from './tokens'
import {
  BalanceMap,
  PriceMap,
  fmtAmount,
  fmtPrice,
  fmtUsd,
  useTokenBalances,
  useTokenPrices
} from './tokenData'

export type { Token } from './tokens'
export { TOKENS }
export * from './tokenData'

const POPULAR = ['WLUNES', 'LUSDT', 'LBTC', 'LETH']

export const tokenIconSrc = (t: Pick<Token, 'icon' | 'address' | 'acronym'>) =>
  t.icon || getTokenLogo(t.address, t.acronym)

/** Token image with identicon fallback. */
export const TokenImg: React.FC<{
  token: Pick<Token, 'icon' | 'address' | 'acronym'>
  size?: number
}> = ({ token, size = 28 }) => (
  <img
    src={tokenIconSrc(token)}
    alt=""
    width={size}
    height={size}
    style={{
      width: size,
      height: size,
      borderRadius: '50%',
      flexShrink: 0,
      objectFit: 'cover',
      background: C.field
    }}
    onError={e => {
      const img = e.currentTarget
      const fb = generateIdenticon(token.address || token.acronym)
      if (img.src !== fb) img.src = fb
    }}
  />
)

const SearchBox = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  height: 48px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid ${C.primary};
  background: ${C.bg};
  input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: #fff;
    font-size: 15px;
  }
`

const Popular = styled.div`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
`

const PopChip = styled.button<{ $dim?: boolean }>`
  ${grotesk};
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 10px 0 5px;
  border-radius: 999px;
  border: 1px solid ${C.borderStrong};
  background: transparent;
  color: #fff;
  font-weight: 600;
  font-size: 13px;
  opacity: ${p => (p.$dim ? 0.45 : 1)};
  transition: border-color 150ms ease;
  &:hover {
    border-color: ${C.primary};
  }
`

const List = styled.div`
  margin: 0 -24px -24px;
  border-top: 1px solid ${C.border};
  padding: 6px 8px 10px;
  max-height: 380px;
  overflow-y: auto;
  @media (max-width: 759px) {
    max-height: 52vh;
    margin-bottom: -20px;
  }
`

const RowBtn = styled.button<{ $dim?: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: #fff;
  text-align: left;
  opacity: ${p => (p.$dim ? 0.5 : 1)};
  transition: background-color 150ms ease;
  &:hover {
    background: ${C.field};
  }
`

const Sym = styled.span`
  ${grotesk};
  font-weight: 600;
  font-size: 15px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
`

const Small = styled.span`
  font-size: 12px;
  color: ${C.muted};
`

const Right = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  ${tabular};
  > span:first-child {
    font-weight: 500;
    font-size: 14px;
  }
`

const Tag = styled.span`
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  font-weight: 600;
  color: ${C.primaryText2};
  background: rgba(108, 56, 255, 0.14);
  border: 1px solid ${C.primaryBorder};
  border-radius: 999px;
  padding: 1px 7px;
`

const None = styled.div`
  padding: 32px 12px;
  text-align: center;
  font-size: 14px;
  color: ${C.muted};
`

export type TokenSelectModalProps = {
  open: boolean
  onClose: () => void
  onSelect: (token: Token) => void
  /** Token on the side being edited — marked "selected"; picking it closes. */
  selected?: Token | null
  /** Token on the opposite side — marked; caller swaps sides when picked. */
  other?: Token | null
  tokens?: Token[]
  balances?: BalanceMap
  prices?: PriceMap
  title?: string
}

const same = (a?: Token | null, b?: Token | null) =>
  !!a && !!b && a.acronym === b.acronym

export const TokenSelectModal: React.FC<TokenSelectModalProps> = ({
  open,
  onClose,
  onSelect,
  selected,
  other,
  tokens = TOKENS,
  balances: balancesProp,
  prices: pricesProp,
  title = 'Select a token'
}) => {
  const sdk = useSDK()
  const connected = !!sdk.walletAddress
  const [q, setQ] = useState('')
  const own = useTokenBalances(tokens, open && !balancesProp)
  const ownPrices = useTokenPrices(tokens)
  const balances = balancesProp ?? own.balances
  const prices = pricesProp ?? ownPrices

  const close = () => {
    setQ('')
    onClose()
  }

  const pick = (t: Token) => {
    setQ('')
    if (same(t, selected)) {
      onClose()
      return
    }
    onSelect(t)
    onClose()
  }

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase()
    return tokens
      .filter(
        t =>
          !query ||
          t.acronym.toLowerCase().includes(query) ||
          t.token.toLowerCase().includes(query) ||
          (query.length > 8 && t.address.toLowerCase() === query)
      )
      .map(t => {
        const bal = balances[t.acronym]?.value ?? 0
        const price = prices[t.acronym] ?? 0
        return { t, bal, price, usd: bal * price }
      })
      .sort((a, b) => (connected ? b.usd - a.usd || b.bal - a.bal : 0))
  }, [q, tokens, balances, prices, connected])

  return (
    <Dialog open={open} onClose={close} title={title} width={440}>
      <SearchBox>
        <Search size={16} color={C.muted} strokeWidth={2} />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search name or symbol"
          aria-label="Search tokens"
          data-bare=""
        />
      </SearchBox>
      <Popular>
        {POPULAR.map(sym => {
          const t = tokens.find(x => x.acronym === sym)
          if (!t) return null
          return (
            <PopChip
              key={sym}
              $dim={same(t, selected)}
              onClick={() => pick(t)}
              aria-label={`Select ${sym}`}
            >
              <TokenImg token={t} size={22} />
              {sym}
            </PopChip>
          )
        })}
      </Popular>
      <List role="listbox" aria-label="Tokens">
        {rows.map(({ t, bal, price, usd }) => {
          const isSel = same(t, selected)
          const isOther = same(t, other)
          return (
            <RowBtn
              key={t.id}
              role="option"
              aria-selected={isSel}
              $dim={isSel}
              onClick={() => pick(t)}
            >
              <TokenImg token={t} size={36} />
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2
                }}
              >
                <Sym>
                  {t.acronym}
                  {isOther && (
                    <Tag title="Picking it swaps the two sides">Other side</Tag>
                  )}
                </Sym>
                <Small>
                  {t.token}
                  {isSel ? ' · selected' : ''}
                </Small>
              </div>
              <Right>
                <span>{connected ? fmtAmount(bal) : '—'}</span>
                <Small>
                  {connected
                    ? price > 0
                      ? fmtUsd(usd)
                      : '—'
                    : fmtPrice(price)}
                </Small>
              </Right>
            </RowBtn>
          )
        })}
        {rows.length === 0 && <None>No token matches “{q}”.</None>}
      </List>
    </Dialog>
  )
}

export default TokenSelectModal
