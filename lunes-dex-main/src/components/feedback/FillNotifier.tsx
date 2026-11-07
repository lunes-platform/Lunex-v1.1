/**
 * FillNotifier — app-wide spot fill notifications.
 *
 * While a wallet is connected and has a read session, the spot WebSocket is
 * authenticated with that session and subscribed to the private
 * `user:<address>` channel. Each fill pushed by spot-api becomes:
 *  - maker fills (a resting order filled while the user was elsewhere): a
 *    success toast that rings the bell (async event) and links to Spot;
 *  - taker fills: logged to the notification center only — the user just
 *    placed that order and already saw it in the transaction flow.
 * Renders nothing.
 */
import { useEffect } from 'react'
import { useSDK } from '../../context/SDKContext'
import { useReadSession } from '../../hooks/useReadSession'
import { getReadSessionToken } from '../../services/sessionService'
import { spotWs } from '../../services/spotService'
import { useToast } from './ToastProvider'

type FillEvent = {
  type: 'fill'
  role: 'maker' | 'taker'
  pairSymbol: string
  orderId: string
  tradeId: string
  side: 'BUY' | 'SELL'
  price: string
  amount: string
}

const fmt = (v: string, max = 6) => {
  const n = parseFloat(v)
  if (!Number.isFinite(n)) return v
  return n.toLocaleString('en-US', { maximumFractionDigits: max })
}

export const FillNotifier: React.FC = () => {
  const { walletAddress } = useSDK()
  const { hasSession } = useReadSession()
  const { toast } = useToast()

  useEffect(() => {
    const token = walletAddress ? getReadSessionToken(walletAddress) : null
    if (!walletAddress || !hasSession || !token) {
      spotWs.authenticate(null)
      return
    }

    spotWs.connect()
    spotWs.authenticate(token)

    const channel = `user:${walletAddress}`
    const seen = new Set<string>()
    const onEvent = (data: FillEvent) => {
      if (!data || data.type !== 'fill' || seen.has(data.tradeId)) return
      seen.add(data.tradeId)
      const [base, quote] = data.pairSymbol.split('/')
      const verb = data.side === 'BUY' ? 'Bought' : 'Sold'
      const body =
        `${verb} ${fmt(data.amount)} ${base} @ ${fmt(data.price, 8)} ${quote ?? ''}`.trim()
      const maker = data.role === 'maker'
      toast('success', maker ? 'Limit order filled' : 'Order filled', body, {
        id: `fill-${data.tradeId}`,
        cat: 'market',
        ring: maker,
        logOnly: !maker,
        route: '/spot',
        action: { label: 'Open spot', route: '/spot' }
      })
    }

    spotWs.subscribe(channel, onEvent)
    return () => {
      spotWs.unsubscribe(channel, onEvent)
    }
  }, [walletAddress, hasSession, toast])

  return null
}

export default FillNotifier
