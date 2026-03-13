export function buildSpotOrderSignMessage(input: {
  pairSymbol: string
  side: 'BUY' | 'SELL'
  type: 'LIMIT' | 'MARKET' | 'STOP' | 'STOP_LIMIT'
  price?: string
  stopPrice?: string
  amount: string
  nonce: string
  timestamp: number
}) {
  return `lunex-order:${input.pairSymbol}:${input.side}:${input.type}:${input.price || '0'}:${input.stopPrice || '0'}:${input.amount}:${input.nonce}:${input.timestamp}`
}

export function buildSpotCancelSignMessage(orderId: string) {
  return `lunex-cancel:${orderId}`
}

let signedActionNonceCounter = 0

function normalizeSignedValue(value: string | number | boolean | Array<string | number> | undefined | null) {
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
    timestamp: Date.now(),
  }
}

export function buildWalletActionMessage(input: {
  action: string
  address: string
  nonce: string
  timestamp: number | string
  fields?: Record<string, string | number | boolean | Array<string | number> | undefined | null>
}) {
  const lines = [
    `lunex-auth:${input.action}`,
    `address:${input.address}`,
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
      amount: input.amount,
    },
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
      linkLeaderId: input.linkLeaderId,
    },
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
      expiresInDays: input.expiresInDays,
    },
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
      leverage: input.leverage,
    },
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
      positionId: input.positionId,
    },
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
      positionId: input.positionId,
    },
  })
}
