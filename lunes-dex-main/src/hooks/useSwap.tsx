/**
 * useSwap — quote + execution engine for the Swap screen.
 *
 * Token selection and the typed amount live in AppContext (useSelectOptions);
 * this hook only derives the router quote and builds the tx steps.
 *
 * - Quote: router `getAmountsOut` via `useSDK().getQuote`, debounced 350ms.
 *   While a new quote loads the previous one is kept (`loading` = true) so the
 *   UI can dim it instead of flashing a skeleton.
 * - Execution: `useSDK().executeSwap` (it approves the router itself when the
 *   allowance is short). `needsApproval()` reads the allowance up-front so the
 *   tx flow only shows "Approve X spending" when it is really missing.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSDK } from '../context/SDKContext'
import { contractService } from '../services/contractService'
import { CONTRACTS } from '../config/contracts'
import type { TxStep } from '../context/TxContext'
import type { Option } from '../context/useContext'
import { classifyTrade, isLunes, toRoutingAddress } from '../utils/nativeToken'

export const SWAP_FEE_PCT = 0.5
export const QUOTE_DEBOUNCE_MS = 350

export type SwapQuote = {
  /** Raw integer output (smallest unit of tokenOut). */
  amountOutRaw: string
  amountOut: number
  amountOutFormatted: string
  /** Raw input the quote was computed for. */
  amountInRaw: string
  /** tokenOut per 1 tokenIn, in human units. */
  rate: number
  /** Price impact in percent (e.g. 0.42). */
  priceImpact: number
  route: string[]
  key: string
}

type Params = {
  tokenIn: Option | null
  tokenOut: Option | null
  amountIn: string
  slippage: number
  deadlineMin: number
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const useSwap = ({
  tokenIn,
  tokenOut,
  amountIn,
  slippage,
  deadlineMin
}: Params) => {
  const sdk = useSDK()
  const sdkRef = useRef(sdk)
  sdkRef.current = sdk
  const errRef = useRef<string | null>(sdk.error)
  errRef.current = sdk.error

  const [quote, setQuote] = useState<SwapQuote | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reqId = useRef(0)

  const amountNum = Number(amountIn)
  const valid =
    !!tokenIn?.address &&
    !!tokenOut?.address &&
    tokenIn.acronym !== tokenOut.acronym &&
    Number.isFinite(amountNum) &&
    amountNum > 0
  const key = valid
    ? `${tokenIn!.address}>${tokenOut!.address}:${amountIn}`
    : ''

  const fetchQuote = useCallback(async () => {
    if (!valid || !tokenIn || !tokenOut) return
    const id = ++reqId.current
    const s = sdkRef.current
    setLoading(true)
    try {
      const inRaw = s.parseAmount(amountIn, tokenIn.decimals || 8)
      // LUNES <-> WLUNES is a 1:1 wrap/unwrap on WNative (no Router, no pool).
      if (classifyTrade(tokenIn, tokenOut).kind !== 'swap') {
        setQuote({
          amountOutRaw: inRaw,
          amountOut: amountNum,
          amountOutFormatted: amountIn,
          amountInRaw: inRaw,
          rate: 1,
          priceImpact: 0,
          route: [tokenIn.acronym, tokenOut.acronym],
          key
        })
        setError(null)
        return
      }
      // Pools are WLUNES/X: route the native sentinel to the WLUNES address.
      const res = await s.getQuote(inRaw, [
        toRoutingAddress(tokenIn),
        toRoutingAddress(tokenOut)
      ])
      if (id !== reqId.current) return
      if (!res || !res.amountOut || res.amountOut === '0') {
        setQuote(null)
        setError(errRef.current || 'No liquidity for this pair')
        return
      }
      const outFmt = s.formatAmount(res.amountOut, tokenOut.decimals || 8)
      const out = Number(outFmt) || 0
      setQuote({
        amountOutRaw: res.amountOut,
        amountOut: out,
        amountOutFormatted: outFmt,
        amountInRaw: inRaw,
        rate: amountNum > 0 ? out / amountNum : 0,
        priceImpact: Number(res.priceImpact) || 0,
        route: [tokenIn.acronym, tokenOut.acronym],
        key
      })
      setError(null)
    } catch (err: unknown) {
      if (id !== reqId.current) return
      setQuote(null)
      setError(err instanceof Error ? err.message : 'Could not get a quote')
    } finally {
      if (id === reqId.current) setLoading(false)
    }
    // key captures tokenIn / tokenOut / amountIn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    // invalidate any in-flight quote for the previous inputs
    reqId.current++
    if (!valid) {
      setQuote(null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const t = setTimeout(fetchQuote, QUOTE_DEBOUNCE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Drop the previous quote when the pair changes (only amounts keep it).
  const pairKey = `${tokenIn?.acronym}>${tokenOut?.acronym}`
  useEffect(() => {
    setQuote(null)
  }, [pairKey])

  const isWrapOrUnwrap =
    !!tokenIn && !!tokenOut && classifyTrade(tokenIn, tokenOut).kind !== 'swap'
  const minReceivedRaw = quote
    ? isWrapOrUnwrap
      ? quote.amountOutRaw
      : sdk.calculateMinAmount(quote.amountOutRaw, slippage)
    : '0'
  const minReceived = quote
    ? Number(sdk.formatAmount(minReceivedRaw, tokenOut?.decimals || 8)) || 0
    : 0

  /** True when the router allowance for tokenIn is below the input amount. */
  const needsApproval = useCallback(async (): Promise<boolean> => {
    const s = sdkRef.current
    if (!tokenIn?.address || !s.walletAddress) return false
    // Native input rides as call value; wrap/unwrap never touch the Router.
    if (isLunes(tokenIn) || !tokenOut) return false
    if (classifyTrade(tokenIn, tokenOut).kind !== 'swap') return false
    try {
      const inRaw = s.parseAmount(amountIn, tokenIn.decimals || 8)
      const allowance = await contractService.getAllowance(
        tokenIn.address,
        s.walletAddress,
        CONTRACTS.ROUTER
      )
      return BigInt(allowance || '0') < BigInt(inRaw || '0')
    } catch {
      // unknown → assume approval may be asked (the SDK checks again)
      return true
    }
  }, [tokenIn, tokenOut, amountIn])

  /**
   * Tx steps for `useTx().run`. The SDK call does approve + swap in one go;
   * when an approval is pending we watch the allowance to advance the
   * "Approve" step as soon as it lands.
   */
  const buildSteps = useCallback(
    (withApproval: boolean): TxStep[] => {
      if (!tokenIn || !tokenOut || !quote) return []
      const s = sdkRef.current
      const wallet = s.walletAddress || ''
      const inRaw = quote.amountInRaw
      const params = {
        amountIn: inRaw,
        amountOutMin: minReceivedRaw,
        path: [toRoutingAddress(tokenIn), toRoutingAddress(tokenOut)],
        to: wallet,
        deadline: s.calculateDeadline(deadlineMin),
        // Display tokens let the SDK pick native swap / wrap / unwrap.
        fromToken: tokenIn,
        toToken: tokenOut
      }

      let swapP: Promise<boolean> | null = null
      const start = () => {
        if (!swapP) swapP = s.executeSwap(params)
        return swapP
      }
      // executeSwap swallows errors and returns false → surface its message
      // (so wallet cancellations show as "Request rejected").
      const settle = async () => {
        const ok = await start()
        if (ok) return true
        await sleep(60)
        throw new Error(errRef.current || 'The swap did not complete.')
      }

      const steps: TxStep[] = []
      if (withApproval) {
        steps.push({
          label: `Approve ${tokenIn.acronym} spending`,
          wallet: true,
          run: async () => {
            const p = start()
            let done = false
            const poll = (async () => {
              while (!done) {
                await sleep(1500)
                try {
                  const a = await contractService.getAllowance(
                    tokenIn.address,
                    wallet,
                    CONTRACTS.ROUTER
                  )
                  if (BigInt(a || '0') >= BigInt(inRaw)) return true
                } catch {
                  /* keep polling */
                }
              }
              return true
            })()
            try {
              await Promise.race([p.then(() => undefined), poll])
            } finally {
              done = true
            }
            return true
          }
        })
      }
      steps.push(
        { label: 'Sign swap in your wallet', wallet: true, run: settle },
        { label: 'Waiting for block confirmation' }
      )
      return steps
    },
    [tokenIn, tokenOut, quote, minReceivedRaw, deadlineMin]
  )

  return {
    quote,
    /** True while a (re)quote is pending — keep showing `quote` dimmed. */
    loading: valid && loading,
    error: valid ? error : null,
    minReceived,
    /** LUNES⇄WLUNES: 1:1 via the WLUNES contract, no router fee. */
    isWrapOrUnwrap,
    feeAmount:
      valid && !isWrapOrUnwrap ? (amountNum * SWAP_FEE_PCT) / 100 : 0,
    needsApproval,
    buildSteps,
    refresh: fetchQuote
  }
}

export default useSwap
