let nonceCounter = 0;

export function generateNonce(): string {
    nonceCounter = (nonceCounter + 1) % 1000;
    return `${Date.now()}${nonceCounter.toString().padStart(3, '0')}`;
}

function normalizeWalletActionValue(value: string | number | boolean | Array<string | number> | undefined | null): string {
    if (Array.isArray(value)) {
        return value.join(',');
    }

    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }

    return value == null ? '' : String(value);
}

export function createWalletActionMetadata(): { nonce: string; timestamp: number } {
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
    fields?: Record<string, string | number | boolean | Array<string | number> | undefined | null>;
}): string {
    const lines = [
        `lunex-auth:${input.action}`,
        `address:${input.address}`,
    ];

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

export function buildSpotOrderSignMessage(input: {
    pairSymbol: string;
    side: string;
    type: string;
    price?: string;
    stopPrice?: string;
    amount: string;
    nonce: string;
}): string {
    return `lunex-order:${input.pairSymbol}:${input.side}:${input.type}:${input.price || '0'}:${input.stopPrice || '0'}:${input.amount}:${input.nonce}`;
}

export function buildSpotCancelSignMessage(orderId: string): string {
    return `lunex-cancel:${orderId}`;
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
    source: 'WEB3';
    amountIn: string;
    amountOutMin: string;
    route?: string[];
    maxSlippageBps?: number;
    strategyTag?: string;
    executionPrice?: string;
    realizedPnlPct?: string;
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
            source: input.source,
            strategyTag: input.strategyTag || '',
            amountIn: input.amountIn,
            amountOutMin: input.amountOutMin,
            route: input.route || [],
            maxSlippageBps: input.maxSlippageBps ?? 100,
            executionPrice: input.executionPrice || '',
            realizedPnlPct: input.realizedPnlPct || '',
        },
    });
}
