let nonceCounter = 0;

export function generateNonce(): string {
  nonceCounter = (nonceCounter + 1) % 1000;
  return `${Date.now()}${nonceCounter.toString().padStart(3, '0')}`;
}

function normalizeWalletActionValue(
  value: string | number | boolean | Array<string | number> | undefined | null,
): string {
  if (Array.isArray(value)) {
    return value.join(',');
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  return value == null ? '' : String(value);
}

export function createWalletActionMetadata(): {
  nonce: string;
  timestamp: number;
} {
  return {
    nonce: generateNonce(),
    timestamp: Date.now(),
  };
}

export function buildWalletActionSignMessage(input: {
  action: string;
  address: string;
  nonce: string;
  timestamp: number | string;
  fields?: Record<
    string,
    string | number | boolean | Array<string | number> | undefined | null
  >;
}): string {
  const lines = [`lunex-auth:${input.action}`, `address:${input.address}`];

  const orderedFields = Object.entries(input.fields || {})
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([left], [right]) => left.localeCompare(right));

  for (const [key, value] of orderedFields) {
    lines.push(`${key}:${normalizeWalletActionValue(value)}`);
  }

  lines.push(`nonce:${input.nonce}`);
  lines.push(`timestamp:${normalizeWalletActionValue(input.timestamp)}`);
  return lines.join('\n');
}

function canonicalOrderDecimal(value: string | undefined): string {
  const match = (value || '0')
    .trim()
    .match(/^\+?(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if (!match || (!match[1] && !match[2]))
    throw new Error('Invalid order decimal');
  let digits = (match[1] + (match[2] || '')).replace(/^0+/, '');
  if (!digits) return '0';
  let exponent = Number(match[3] || '0') - (match[2] || '').length;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000)
    throw new Error('Invalid order decimal exponent');
  while (digits.endsWith('0')) {
    digits = digits.slice(0, -1);
    exponent++;
  }
  const point = digits.length + exponent;
  if (point <= 0) return '0.' + '0'.repeat(-point) + digits;
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
  return digits.slice(0, point) + '.' + digits.slice(point);
}

export function buildSpotOrderSignMessage(input: {
  pairSymbol: string;
  side: string;
  type: string;
  price?: string;
  stopPrice?: string;
  amount: string;
  nonce: string;
  timestamp: number | string;
  timeInForce?: string;
  expiresAt?: string | Date | null;
}) {
  const expiry = input.expiresAt ? new Date(input.expiresAt).getTime() : 0;
  return `lunex-order-v2:${input.pairSymbol}:${input.side}:${input.type}:${canonicalOrderDecimal(input.price)}:${canonicalOrderDecimal(input.stopPrice)}:${canonicalOrderDecimal(input.amount)}:${input.nonce}:${input.timestamp}:${input.timeInForce || 'GTC'}:${expiry}`;
}

export function buildSpotCancelSignMessage(input: {
  address: string;
  orderId: string;
  nonce: string;
  timestamp: number | string;
}): string {
  return buildWalletActionSignMessage({
    action: 'orders.cancel',
    address: input.address,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: {
      orderId: input.orderId,
    },
  });
}

export function buildSocialFollowSignMessage(input: {
  leaderId: string;
  address: string;
  nonce: string;
  timestamp: number;
}): string {
  return buildWalletActionSignMessage({
    action: 'social.follow-leader',
    address: input.address,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: { leaderId: input.leaderId },
  });
}

export function buildSocialUnfollowSignMessage(input: {
  leaderId: string;
  address: string;
  nonce: string;
  timestamp: number;
}): string {
  return buildWalletActionSignMessage({
    action: 'social.unfollow-leader',
    address: input.address,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: { leaderId: input.leaderId },
  });
}

export function buildSocialLikeIdeaSignMessage(input: {
  ideaId: string;
  address: string;
  nonce: string;
  timestamp: number;
}): string {
  return buildWalletActionSignMessage({
    action: 'social.like-idea',
    address: input.address,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: { ideaId: input.ideaId },
  });
}

export function buildSocialUnlikeIdeaSignMessage(input: {
  ideaId: string;
  address: string;
  nonce: string;
  timestamp: number;
}): string {
  return buildWalletActionSignMessage({
    action: 'social.unlike-idea',
    address: input.address,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: { ideaId: input.ideaId },
  });
}

export function buildSocialCommentSignMessage(input: {
  ideaId: string;
  address: string;
  content: string;
  nonce: string;
  timestamp: number;
}): string {
  return buildWalletActionSignMessage({
    action: 'social.comment-idea',
    address: input.address,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: {
      ideaId: input.ideaId,
      content: input.content,
    },
  });
}

export function buildCopytradeDepositSignMessage(input: {
  leaderId: string;
  followerAddress: string;
  token: string;
  amount: string;
  nonce: string;
  timestamp: number;
}): string {
  return buildWalletActionSignMessage({
    action: 'copytrade.deposit',
    address: input.followerAddress,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: {
      leaderId: input.leaderId,
      token: input.token,
      amount: input.amount,
    },
  });
}

export function buildCopytradeWithdrawSignMessage(input: {
  leaderId: string;
  followerAddress: string;
  shares: string;
  nonce: string;
  timestamp: number;
}): string {
  return buildWalletActionSignMessage({
    action: 'copytrade.withdraw',
    address: input.followerAddress,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: {
      leaderId: input.leaderId,
      shares: input.shares,
    },
  });
}

export function buildAgentRegisterSignMessage(input: {
  address: string;
  agentType: 'HUMAN' | 'AI_AGENT' | 'OPENCLAW_BOT' | 'ALGO_BOT';
  framework?: string;
  strategyDescription?: string;
  linkLeaderId?: string;
  nonce: string;
  timestamp: number;
}): string {
  return buildWalletActionSignMessage({
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
  });
}

export function buildAgentCreateApiKeySignMessage(input: {
  address: string;
  agentId: string;
  label?: string;
  permissions: string[];
  expiresInDays?: number;
  nonce: string;
  timestamp: number;
}): string {
  return buildWalletActionSignMessage({
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
  });
}

export function buildCopytradeWeb3SignalSignMessage(input: {
  leaderId: string;
  leaderAddress: string;
  pairSymbol: string;
  side: string;
  positionEffect?: 'AUTO' | 'OPEN' | 'CLOSE';
  signalMode?: 'AUTO' | 'JOURNAL' | 'EXECUTE_VAULT';
  source: 'WEB3';
  amountIn: string;
  amountOutMin: string;
  route?: string[];
  maxSlippageBps?: number;
  strategyTag?: string;
  executionPrice?: string;
  nonce: string;
  timestamp: number;
}): string {
  return buildWalletActionSignMessage({
    action: 'copytrade.web3-signal',
    address: input.leaderAddress,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: {
      leaderId: input.leaderId,
      pairSymbol: input.pairSymbol,
      side: input.side,
      positionEffect: input.positionEffect || 'AUTO',
      signalMode: input.signalMode || 'AUTO',
      source: input.source,
      strategyTag: input.strategyTag || '',
      amountIn: input.amountIn,
      amountOutMin: input.amountOutMin,
      route: input.route || [],
      maxSlippageBps: input.maxSlippageBps ?? 100,
      executionPrice: input.executionPrice || '',
    },
  });
}

export function buildCopytradeConfirmWalletSignalSignMessage(input: {
  leaderId: string;
  signalId: string;
  leaderAddress: string;
  txHash: string;
  amountOut?: string;
  executionPrice?: string;
  nonce: string;
  timestamp: number;
}): string {
  return buildWalletActionSignMessage({
    action: 'copytrade.confirm-wallet-signal',
    address: input.leaderAddress,
    nonce: input.nonce,
    timestamp: input.timestamp,
    fields: {
      leaderId: input.leaderId,
      signalId: input.signalId,
      txHash: input.txHash,
      amountOut: input.amountOut || '',
      executionPrice: input.executionPrice || '',
    },
  });
}

/**
 * Auth object passed by SDK consumers to authenticate read requests.
 * All fields are optional — the module resolves missing fields by generating
 * them on-the-fly and calling `signMessage` if a pre-signed signature is absent.
 */
export type SignedReadAuth = {
  nonce?: string;
  timestamp?: number;
  signature?: string;
  signMessage?: (message: string) => Promise<string>;
};

export function signedReadHeaders(signed: {
  nonce: string;
  timestamp: number;
  signature: string;
}) {
  return {
    'X-Lunex-Nonce': signed.nonce,
    'X-Lunex-Timestamp': String(signed.timestamp),
    'X-Lunex-Signature': signed.signature,
  };
}
