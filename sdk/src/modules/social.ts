import { HttpClient } from '../http-client';
import {
    SocialFollowResult,
    SocialIdea,
    SocialIdeaComment,
    SocialIdeaLikeResult,
    SocialLeader,
    SocialSignedAddressActionInput,
    SocialSignedCommentInput,
    SocialStats,
} from '../spot-types';

export class SocialModule {
    constructor(private http: HttpClient) { }

    async getStats(): Promise<SocialStats> {
        const response = await this.http.get<{ stats: SocialStats }>('/api/v1/social/stats');
        return response.stats;
    }

    async getLeaders(params?: {
        tab?: 'all' | 'traders' | 'bots';
        search?: string;
        sortBy?: 'roi30d' | 'followers' | 'winRate' | 'sharpe';
        limit?: number;
    }): Promise<SocialLeader[]> {
        const response = await this.http.get<{ leaders: SocialLeader[] }>('/api/v1/social/leaders', params);
        return response.leaders;
    }

    async getLeaderboard(limit = 10): Promise<SocialLeader[]> {
        const response = await this.http.get<{ leaderboard: SocialLeader[] }>('/api/v1/social/leaderboard', { limit });
        return response.leaderboard;
    }

    async getLeaderProfile(leaderId: string, viewerAddress?: string): Promise<SocialLeader> {
        const response = await this.http.get<{ leader: SocialLeader }>(`/api/v1/social/leaders/${leaderId}`, { viewerAddress });
        return response.leader;
    }

    async getIdeas(limit = 50): Promise<SocialIdea[]> {
        const response = await this.http.get<{ ideas: SocialIdea[] }>('/api/v1/social/ideas', { limit });
        return response.ideas;
    }

    async getFollowing(address: string): Promise<SocialLeader[]> {
        const response = await this.http.get<{ leaders: SocialLeader[] }>('/api/v1/social/following', { address });
        return response.leaders;
    }

    async followLeader(leaderId: string, input: SocialSignedAddressActionInput): Promise<SocialFollowResult> {
        return this.http.post(`/api/v1/social/leaders/${leaderId}/follow`, input);
    }

    async unfollowLeader(leaderId: string, input: SocialSignedAddressActionInput): Promise<SocialFollowResult> {
        return this.http.delete(`/api/v1/social/leaders/${leaderId}/follow`, input);
    }

    async likeIdea(ideaId: string, input: SocialSignedAddressActionInput): Promise<SocialIdeaLikeResult> {
        return this.http.post(`/api/v1/social/ideas/${ideaId}/like`, input);
    }

    async unlikeIdea(ideaId: string, input: SocialSignedAddressActionInput): Promise<SocialIdeaLikeResult> {
        return this.http.delete(`/api/v1/social/ideas/${ideaId}/like`, input);
    }

    async commentOnIdea(ideaId: string, input: SocialSignedCommentInput): Promise<SocialIdeaComment> {
        const response = await this.http.post<{ comment: SocialIdeaComment }>(`/api/v1/social/ideas/${ideaId}/comments`, input);
        return response.comment;
    }
}
