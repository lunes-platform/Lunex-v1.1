import { HttpClient } from '../http-client';
import {
    CopytradeActivity,
    CopytradeApiKeyChallenge,
    CopytradeApiKeyResult,
    CopytradeDepositResult,
    CopytradeExecution,
    CopytradePosition,
    CopytradeSignedDepositInput,
    CopytradeSignedWithdrawInput,
    CopytradeSignalResult,
    CopytradeVaultDetails,
    CopytradeVaultSummary,
    CopytradeWithdrawResult,
    CreateCopytradeSignalInput,
} from '../spot-types';

export class CopytradeModule {
    constructor(private http: HttpClient) { }

    async getVaults(): Promise<CopytradeVaultSummary[]> {
        const response = await this.http.get<{ vaults: CopytradeVaultSummary[] }>('/api/v1/copytrade/vaults');
        return response.vaults;
    }

    async getVaultByLeader(leaderId: string): Promise<CopytradeVaultDetails> {
        const response = await this.http.get<{ vault: CopytradeVaultDetails }>(`/api/v1/copytrade/vaults/${leaderId}`);
        return response.vault;
    }

    async getPositions(address: string): Promise<CopytradePosition[]> {
        const response = await this.http.get<{ positions: CopytradePosition[] }>('/api/v1/copytrade/positions', { address });
        return response.positions;
    }

    async getActivity(address?: string, limit = 50): Promise<CopytradeActivity[]> {
        const response = await this.http.get<{ activity: CopytradeActivity[] }>('/api/v1/copytrade/activity', {
            address,
            limit,
        });
        return response.activity;
    }

    async getVaultExecutions(leaderId: string, limit = 50): Promise<CopytradeExecution[]> {
        const response = await this.http.get<{ executions: CopytradeExecution[] }>(
            `/api/v1/copytrade/vaults/${leaderId}/executions`,
            { limit },
        );
        return response.executions;
    }

    async depositToVault(leaderId: string, input: CopytradeSignedDepositInput): Promise<CopytradeDepositResult> {
        return this.http.post(`/api/v1/copytrade/vaults/${leaderId}/deposit`, input);
    }

    async withdrawFromVault(leaderId: string, input: CopytradeSignedWithdrawInput): Promise<CopytradeWithdrawResult> {
        return this.http.post(`/api/v1/copytrade/vaults/${leaderId}/withdraw`, input);
    }

    async createApiKeyChallenge(leaderId: string, leaderAddress: string): Promise<CopytradeApiKeyChallenge> {
        return this.http.get(`/api/v1/copytrade/leaders/${leaderId}/api-key/challenge`, { leaderAddress });
    }

    async rotateApiKey(
        leaderId: string,
        input: { leaderAddress: string; challengeId: string; signature: string },
    ): Promise<CopytradeApiKeyResult> {
        return this.http.post(`/api/v1/copytrade/leaders/${leaderId}/api-key`, input);
    }

    async submitSignal(
        leaderId: string,
        input: CreateCopytradeSignalInput,
        options?: { apiKey?: string },
    ): Promise<CopytradeSignalResult> {
        return this.http.post(
            `/api/v1/copytrade/vaults/${leaderId}/signals`,
            {
                ...input,
                source: input.source || 'API',
            },
            options,
        );
    }
}
