import { SocialLeadersQuery, UpsertLeaderProfileInput, CopyVaultDepositInput, CopyVaultWithdrawInput } from '../utils/validation';
export declare const socialService: {
    getStats(): Promise<{
        totalAum: number;
        activeTraaders: number;
        aiAgents: number;
        totalFollowers: number;
        totalIdeas: number;
        totalVaultEquity: number;
    }>;
    listLeaders(query: SocialLeadersQuery): Promise<any[]>;
    getLeaderboard(limit?: number): Promise<any[]>;
    getLeaderProfile(leaderId: string, viewerAddress?: string): Promise<{
        id: any;
        name: any;
        username: any;
        address: any;
        avatar: any;
        isAI: any;
        isVerified: any;
        bio: any;
        memberSince: string;
        roi30d: number;
        roi90d: number;
        aum: string;
        aumRaw: number;
        drawdown: number;
        followers: any;
        winRate: number;
        avgProfit: number;
        sharpe: number;
        fee: number;
        socialLinks: {
            twitterUrl: any;
            telegramUrl: any;
            discordUrl: any;
        };
        pnlHistory: any;
        tags: any;
        isFollowing: boolean;
        vault: {
            id: any;
            name: any;
            collateralToken: any;
            status: any;
            totalEquity: number;
            totalShares: number;
            totalDeposits: number;
            totalWithdrawals: number;
            minDeposit: number;
            twapThreshold: number;
            maxSlippageBps: any;
        } | null;
        trades: any;
        ideas: any;
    }>;
    getLeaderProfileByAddress(address: string, viewerAddress?: string): Promise<{
        id: any;
        name: any;
        username: any;
        address: any;
        avatar: any;
        isAI: any;
        isVerified: any;
        bio: any;
        memberSince: string;
        roi30d: number;
        roi90d: number;
        aum: string;
        aumRaw: number;
        drawdown: number;
        followers: any;
        winRate: number;
        avgProfit: number;
        sharpe: number;
        fee: number;
        socialLinks: {
            twitterUrl: any;
            telegramUrl: any;
            discordUrl: any;
        };
        pnlHistory: any;
        tags: any;
        isFollowing: boolean;
        vault: {
            id: any;
            name: any;
            collateralToken: any;
            status: any;
            totalEquity: number;
            totalShares: number;
            totalDeposits: number;
            totalWithdrawals: number;
            minDeposit: number;
            twapThreshold: number;
            maxSlippageBps: any;
        } | null;
        trades: any;
        ideas: any;
    }>;
    upsertLeaderProfile(input: UpsertLeaderProfileInput): Promise<{
        id: any;
        name: any;
        username: any;
        address: any;
        avatar: any;
        isAI: any;
        isVerified: any;
        bio: any;
        memberSince: string;
        roi30d: number;
        roi90d: number;
        aum: string;
        aumRaw: number;
        drawdown: number;
        followers: any;
        winRate: number;
        avgProfit: number;
        sharpe: number;
        fee: number;
        socialLinks: {
            twitterUrl: any;
            telegramUrl: any;
            discordUrl: any;
        };
        pnlHistory: any;
        tags: any;
        isFollowing: boolean;
        vault: {
            id: any;
            name: any;
            collateralToken: any;
            status: any;
            totalEquity: number;
            totalShares: number;
            totalDeposits: number;
            totalWithdrawals: number;
            minDeposit: number;
            twapThreshold: number;
            maxSlippageBps: any;
        } | null;
        trades: any;
        ideas: any;
    }>;
    followLeader(leaderId: string, address: string): Promise<{
        followed: boolean;
        alreadyFollowing: boolean;
    }>;
    unfollowLeader(leaderId: string, address: string): Promise<{
        followed: boolean;
        alreadyFollowing: boolean;
    }>;
    getFollowedLeaders(address: string): Promise<{
        id: any;
        name: any;
        username: any;
        address: any;
        avatar: any;
        isAI: any;
        isVerified: any;
        bio: any;
        memberSince: string;
        roi30d: number;
        roi90d: number;
        aum: string;
        aumRaw: number;
        drawdown: number;
        followers: any;
        winRate: number;
        avgProfit: number;
        sharpe: number;
        fee: number;
        socialLinks: {
            twitterUrl: any;
            telegramUrl: any;
            discordUrl: any;
        };
        pnlHistory: any;
        tags: any;
        isFollowing: boolean;
        vault: {
            id: any;
            name: any;
            collateralToken: any;
            status: any;
            totalEquity: number;
            totalShares: number;
            totalDeposits: number;
            totalWithdrawals: number;
            minDeposit: number;
            twapThreshold: number;
            maxSlippageBps: any;
        } | null;
        trades: any;
        ideas: any;
    }[]>;
    getLeaderFollowers(leaderId: string, limit?: number): Promise<{
        id: any;
        address: any;
        name: any;
        username: any;
        initials: string;
        avatar: any;
        followedAt: any;
    }[]>;
    listIdeas(limit?: number): Promise<{
        id: any;
        title: any;
        description: any;
        pair: any;
        direction: any;
        likes: any;
        comments: any;
        date: any;
        tags: any;
        leader: {
            id: any;
            name: any;
            username: any;
            isAI: any;
        } | undefined;
    }[]>;
    getIdeaComments(ideaId: string, limit?: number): Promise<{
        id: any;
        address: any;
        author: any;
        initials: string;
        avatar: any;
        createdAt: any;
        content: any;
    }[]>;
    likeIdea(ideaId: string, address: string): Promise<{
        liked: boolean;
        alreadyLiked: boolean;
        likes?: undefined;
    } | {
        liked: boolean;
        alreadyLiked: boolean;
        likes: number;
    }>;
    unlikeIdea(ideaId: string, address: string): Promise<{
        liked: boolean;
        alreadyLiked: boolean;
        likes: number;
    }>;
    depositToVault(leaderId: string, input: CopyVaultDepositInput): Promise<any>;
    withdrawFromVault(leaderId: string, input: CopyVaultWithdrawInput): Promise<any>;
    commentOnIdea(ideaId: string, address: string, content: string): Promise<{
        id: string;
        address: string;
        author: string;
        initials: string;
        avatar: string;
        content: string;
        createdAt: string;
    }>;
};
//# sourceMappingURL=socialService.d.ts.map