import { CopyTradeApiKeyChallengeInput, CopyTradeApiKeyInput, CopyTradeSignalInput, CopyVaultDepositInput, CopyVaultWithdrawInput } from '../utils/validation';
export declare const copytradeService: {
    createApiKeyChallenge(leaderId: string, input: CopyTradeApiKeyChallengeInput): Promise<{
        challengeId: string;
        message: string;
        expiresAt: string;
    }>;
    createOrRotateApiKey(leaderId: string, input: CopyTradeApiKeyInput): Promise<{
        apiKey: string;
        allowApiTrading: boolean;
    }>;
    validateLeaderApiKey(leaderId: string, apiKey: string): Promise<{
        leaderId: string;
        username: string;
        allowApiTrading: true;
    }>;
    listVaults(): Promise<{
        id: string;
        leaderId: string;
        name: string;
        collateralToken: string;
        status: import(".prisma/client").$Enums.CopyVaultStatus;
        totalEquity: number;
        totalShares: number;
        totalDeposits: number;
        totalWithdrawals: number;
        minDeposit: number;
        twapThreshold: number;
        maxSlippageBps: number;
        leader: {
            id: string;
            name: string;
            username: string;
            isAI: boolean;
            isVerified: boolean;
            fee: number;
            followers: number;
            aum: number;
        };
    }[]>;
    getVaultByLeader(leaderId: string): Promise<{
        id: string;
        leaderId: string;
        name: string;
        collateralToken: string;
        status: import(".prisma/client").$Enums.CopyVaultStatus;
        totalEquity: number;
        totalShares: number;
        totalDeposits: number;
        totalWithdrawals: number;
        minDeposit: number;
        twapThreshold: number;
        maxSlippageBps: number;
        leader: {
            id: string;
            name: string;
            username: string;
            address: string;
            isAI: boolean;
            performanceFee: number;
        };
        positions: {
            id: string;
            followerAddress: string;
            shareBalance: number;
            estimatedValue: number;
            netDeposited: number;
            totalWithdrawn: number;
            highWaterMarkValue: number;
            feePaid: number;
            realizedPnl: number;
        }[];
    }>;
    getUserPositions(address: string): Promise<{
        id: string;
        followerAddress: string;
        shareBalance: number;
        currentValue: number;
        netDeposited: number;
        totalWithdrawn: number;
        highWaterMarkValue: number;
        feePaid: number;
        realizedPnl: number;
        vault: {
            id: string;
            name: string;
            collateralToken: string;
            leaderId: string;
            leaderName: string;
            leaderUsername: string;
        };
    }[]>;
    depositToVault(leaderId: string, input: CopyVaultDepositInput): Promise<{
        depositId: string;
        sharesMinted: number;
        amount: number;
        positionId: string;
    }>;
    withdrawFromVault(leaderId: string, input: CopyVaultWithdrawInput): Promise<{
        withdrawalId: string;
        grossAmount: number;
        feeAmount: number;
        netAmount: number;
        profitAmount: number;
        remainingShares: number;
        collateralToken: string;
        followerAddress: string;
    }>;
    createSignal(leaderId: string, input: CopyTradeSignalInput): Promise<{
        signalId: string;
        pairSymbol: string;
        side: import(".prisma/client").$Enums.OrderSide;
        amountIn: number;
        totalAmountOut: number;
        executionPrice: number;
        slices: {
            id: string;
            sliceIndex: number;
            totalSlices: number;
            amountIn: number;
            amountOut: number;
            executionPrice: number;
        }[];
    }>;
    getVaultExecutions(leaderId: string, limit?: number): Promise<{
        id: string;
        pairSymbol: string;
        side: import(".prisma/client").$Enums.OrderSide;
        sliceIndex: number;
        totalSlices: number;
        amountIn: number;
        amountOut: number;
        executionPrice: number;
        slippageBps: number | null;
        status: import(".prisma/client").$Enums.CopyTradeExecutionStatus;
        strategyTag: string | null;
        createdAt: Date;
    }[]>;
    getActivity(address?: string, limit?: number): Promise<({
        type: string;
        createdAt: Date;
        leaderId: string;
        leaderName: string;
        followerAddress: string;
        amount: number;
        token: string;
    } | {
        type: string;
        createdAt: Date;
        leaderId: string;
        leaderName: string;
        followerAddress: string;
        grossAmount: number;
        feeAmount: number;
        netAmount: number;
        token: string;
    } | {
        type: string;
        createdAt: Date;
        leaderId: string;
        leaderName: string;
        pairSymbol: string;
        side: import(".prisma/client").$Enums.OrderSide;
        amountIn: number;
        executionPrice: number;
        slices: number;
    })[]>;
};
//# sourceMappingURL=copytradeService.d.ts.map