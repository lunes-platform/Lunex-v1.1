function canonicalOrderDecimal(value: string | undefined): string {
  const match = (value || '0')
    .trim()
    .match(/^\+?(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i)
  if (!match || (!match[1] && !match[2]))
    throw new Error('Invalid order decimal')
  let digits = (match[1] + (match[2] || '')).replace(/^0+/, '')
  if (!digits) return '0'
  let exponent = Number(match[3] || '0') - (match[2] || '').length
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000)
    throw new Error('Invalid order decimal exponent')
  while (digits.endsWith('0')) {
    digits = digits.slice(0, -1)
    exponent++
  }
  const point = digits.length + exponent
  if (point <= 0) return '0.' + '0'.repeat(-point) + digits
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length)
  return digits.slice(0, point) + '.' + digits.slice(point)
}

// ─── Signing context (FE-03) ─────────────────────────────────────
// Every signed message is bound to the app domain and the chain genesis so a
// signature made on sandbox/testnet can never be replayed on mainnet. The
// API verifies against its own SIGNING_DOMAIN / LUNES_GENESIS_HASH.

export type SigningContext = { domain: string; chain: string }

let runtimeChainGenesis: string | null = null

/**
 * Sets the chain genesis at runtime (e.g. `api.genesisHash.toHex()` once the
 * node connection is ready). REACT_APP_LUNES_GENESIS_HASH takes precedence.
 */
export function setSigningChainGenesis(hash: string | null | undefined) {
  runtimeChainGenesis = hash ? hash.trim().toLowerCase() : null
}

// Vite replaces `process.env.REACT_APP_*` only when the variable is defined;
// an undefined one would throw ReferenceError in the browser.
function readEnvDomain(): string | undefined {
  try {
    return process.env.REACT_APP_SIGNING_DOMAIN
  } catch {
    return undefined
  }
}

function readEnvGenesis(): string | undefined {
  try {
    return process.env.REACT_APP_LUNES_GENESIS_HASH
  } catch {
    return undefined
  }
}

export function getSigningContext(): SigningContext {
  const host =
    typeof window !== 'undefined' && window.location
      ? window.location.hostname
      : ''
  const domain = (readEnvDomain() || host || 'localhost').trim().toLowerCase()
  const chain = (readEnvGenesis() || runtimeChainGenesis || '')
    .trim()
    .toLowerCase()
  return { domain, chain }
}

export function buildSpotOrderSignMessage(input: {
  pairSymbol: string
  side: 'BUY' | 'SELL'
  type: 'LIMIT' | 'MARKET' | 'STOP' | 'STOP_LIMIT'
  price?: string
  stopPrice?: string
  amount: string
  nonce: string
  timestamp: number
  timeInForce?: string
  expiresAt?: string | Date | null
}) {
  const expiry = input.expiresAt ? new Date(input.expiresAt).getTime() : 0
  const { domain, chain } = getSigningContext()
  return `lunex-order-v3:${domain}:${chain}:${input.pairSymbol}:${input.side}:${input.type}:${canonicalOrderDecimal(input.price)}:${canonicalOrderDecimal(input.stopPrice)}:${canonicalOrderDecimal(input.amount)}:${input.nonce}:${input.timestamp}:${input.timeInForce || 'GTC'}:${expiry}`
}

export function buildSpotCancelSignMessage(input: {
  address: string
  orderId: string
  nonce: string
  timestamp: number
}) {
  return buildWalletActionMessage({
    action: 'orders.cancel',
    address: input.address,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: {
      orderId: input.orderId
    }
  })
}

let signedActionNonceCounter = 0

function normalizeSignedValue(
  value: string | number | boolean | Array<string | number> | undefined | null
) {
  if (Array.isArray(value)) {
    return value.join(',')
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }

  return value == null ? '' : String(value)
}

export function createSignedActionMetadata() {
  signedActionNonceCounter = (signedActionNonceCounter + 1) % 1000
  return {
    nonce: `${Date.now()}${signedActionNonceCounter.toString().padStart(3, '0')}`,
    timestamp: Date.now()
  }
}

export function buildWalletActionMessage(input: {
  action: string
  address: string
  nonce: string
  timestamp: number | string
  fields?: Record<
    string,
    string | number | boolean | Array<string | number> | undefined | null
  >
}) {
  const { domain, chain } = getSigningContext()
  const lines = [
    `lunex-auth:${input.action}`,
    `domain:${domain}`,
    `chain:${chain}`,
    `address:${input.address}`
  ]

  const orderedFields = Object.entries(input.fields ?? {})
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([left], [right]) => left.localeCompare(right))

  for (const [key, value] of orderedFields) {
    lines.push(`${key}:${normalizeSignedValue(value)}`)
  }

  lines.push(`nonce:${input.nonce}`)
  lines.push(`timestamp:${normalizeSignedValue(input.timestamp)}`)
  return lines.join('\n')
}

export function signedAuthHeaders(auth: {
  nonce: string
  timestamp: number
  signature: string
}): HeadersInit {
  return {
    'X-Lunex-Nonce': auth.nonce,
    'X-Lunex-Timestamp': String(auth.timestamp),
    'X-Lunex-Signature': auth.signature
  }
}

export function buildMarginCollateralSignMessage(input: {
  address: string
  action: 'deposit' | 'withdraw'
  token: string
  amount: string
  nonce: string
  timestamp: number
}) {
  return buildWalletActionMessage({
    action: `margin.collateral.${input.action}`,
    address: input.address,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: {
      token: input.token,
      amount: input.amount
    }
  })
}

export function buildAgentRegisterSignMessage(input: {
  address: string
  agentType: 'HUMAN' | 'AI_AGENT' | 'OPENCLAW_BOT' | 'ALGO_BOT'
  framework?: string
  strategyDescription?: string
  linkLeaderId?: string
  nonce: string
  timestamp: number
}) {
  return buildWalletActionMessage({
    action: 'agents.register',
    address: input.address,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: {
      agentType: input.agentType,
      framework: input.framework,
      strategyDescription: input.strategyDescription,
      linkLeaderId: input.linkLeaderId
    }
  })
}

export function buildAgentCreateApiKeySignMessage(input: {
  address: string
  agentId: string
  label?: string
  permissions: string[]
  expiresInDays?: number
  nonce: string
  timestamp: number
}) {
  return buildWalletActionMessage({
    action: 'agents.create-api-key',
    address: input.address,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: {
      agentId: input.agentId,
      label: input.label,
      permissions: input.permissions,
      expiresInDays: input.expiresInDays
    }
  })
}

export function buildAsymmetricCreateStrategySignMessage(input: {
  address: string
  pairAddress: string
  isAutoRebalance: boolean
  buyK: string
  buyGamma: number
  buyMaxCapacity: string
  buyFeeTargetBps?: number
  sellGamma: number
  sellMaxCapacity: string
  sellFeeTargetBps?: number
  sellProfitTargetBps?: number
  leverageL?: string
  allocationC?: number
  nonce: string
  timestamp: number
}) {
  return buildWalletActionMessage({
    action: 'asymmetric.strategy.create',
    address: input.address,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: {
      pairAddress: input.pairAddress,
      isAutoRebalance: input.isAutoRebalance,
      buyK: input.buyK,
      buyGamma: input.buyGamma,
      buyMaxCapacity: input.buyMaxCapacity,
      buyFeeTargetBps: input.buyFeeTargetBps,
      sellGamma: input.sellGamma,
      sellMaxCapacity: input.sellMaxCapacity,
      sellFeeTargetBps: input.sellFeeTargetBps,
      sellProfitTargetBps: input.sellProfitTargetBps,
      leverageL: input.leverageL,
      allocationC: input.allocationC
    }
  })
}

export function buildMarginOpenPositionSignMessage(input: {
  address: string
  pairSymbol: string
  side: 'BUY' | 'SELL'
  collateralAmount: string
  leverage: string
  nonce: string
  timestamp: number
}) {
  return buildWalletActionMessage({
    action: 'margin.position.open',
    address: input.address,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: {
      pairSymbol: input.pairSymbol,
      side: input.side,
      collateralAmount: input.collateralAmount,
      leverage: input.leverage
    }
  })
}

export function buildMarginClosePositionSignMessage(input: {
  address: string
  positionId: string
  nonce: string
  timestamp: number
}) {
  return buildWalletActionMessage({
    action: 'margin.position.close',
    address: input.address,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: {
      positionId: input.positionId
    }
  })
}

export function buildMarginLiquidatePositionSignMessage(input: {
  address: string
  positionId: string
  nonce: string
  timestamp: number
}) {
  return buildWalletActionMessage({
    action: 'margin.position.liquidate',
    address: input.address,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: {
      positionId: input.positionId
    }
  })
}
