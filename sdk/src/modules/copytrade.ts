import { HttpClient } from '../http-client';
import {
  CopytradeActivity,
  CopytradeApiKeyChallenge,
  CopytradeApiKeyResult,
  CopytradeConfirmWalletSignalInput,
  CopytradeConfirmWalletSignalResult,
  CopytradeDepositResult,
  CopytradeExecution,
  CopytradePendingWalletSignal,
  CopytradePosition,
  CopytradeSignedDepositInput,
  CopytradeSignedWithdrawInput,
  CopytradeSignalResult,
  CopytradeVaultDetails,
  CopytradeVaultSummary,
  CopytradeWithdrawResult,
  CreateCopytradeSignalInput,
} from '../spot-types';
import {
  buildWalletActionSignMessage,
  createWalletActionMetadata,
} from '../spot-utils';

type SignedReadAuth = {
  nonce?: string;
  timestamp?: number;
  signature?: string;
  signMessage?: (message: string) => Promise<string>;
};

export class CopytradeModule {
  constructor(private http: HttpClient) {}

  private async resolveSignedRead(input: {
    action: string;
    address: string;
    fields?: Record<
      string,
      string | number | boolean | Array<string | number> | undefined | null
    >;
    auth?: SignedReadAuth;
  }): Promise<{ nonce: string; timestamp: number; signature: string }> {
    const auth = input.auth;
    const metadata = createWalletActionMetadata();
    const nonce = auth?.nonce ?? metadata.nonce;
    const timestamp = auth?.timestamp ?? metadata.timestamp;

    if (auth?.signature) {
      if (!auth.nonce || !auth.timestamp) {
        throw new Error(
          'signed read requires nonce and timestamp when signature is provided',
        );
      }
      return { nonce, timestamp, signature: auth.signature };
    }

    if (!auth?.signMessage) {
      throw new Error(
        'signed read requires auth.signMessage or explicit nonce/timestamp/signature',
      );
    }

    const message = buildWalletActionSignMessage({
      action: input.action,
      address: input.address,
      nonce,
      timestamp,
      fields: input.fields,
    });
    const signature = await auth.signMessage(message);
    return { nonce, timestamp, signature };
  }

  async getVaults(): Promise<CopytradeVaultSummary[]> {
    const response = await this.http.get<{ vaults: CopytradeVaultSummary[] }>(
      '/api/v1/copytrade/vaults',
    );
    return response.vaults;
  }

  async getVaultByLeader(leaderId: string): Promise<CopytradeVaultDetails> {
    const response = await this.http.get<{ vault: CopytradeVaultDetails }>(
      `/api/v1/copytrade/vaults/${leaderId}`,
    );
    return response.vault;
  }

  async getPositions(
    address: string,
    auth?: SignedReadAuth,
  ): Promise<CopytradePosition[]> {
    const signed = await this.resolveSignedRead({
      action: 'copytrade.positions',
      address,
      auth,
    });

    const response = await this.http.get<{ positions: CopytradePosition[] }>(
      '/api/v1/copytrade/positions',
      {
        address,
        nonce: signed.nonce,
        timestamp: signed.timestamp,
        signature: signed.signature,
      },
    );
    return response.positions;
  }

  async getActivity(
    address: string,
    limit = 50,
    auth?: SignedReadAuth,
  ): Promise<CopytradeActivity[]> {
    const signed = await this.resolveSignedRead({
      action: 'copytrade.activity',
      address,
      fields: { limit },
      auth,
    });

    const response = await this.http.get<{ activity: CopytradeActivity[] }>(
      '/api/v1/copytrade/activity',
      {
        address,
        limit,
        nonce: signed.nonce,
        timestamp: signed.timestamp,
        signature: signed.signature,
      },
    );
    return response.activity;
  }

  async getVaultExecutions(
    leaderId: string,
    limit = 50,
  ): Promise<CopytradeExecution[]> {
    const response = await this.http.get<{ executions: CopytradeExecution[] }>(
      `/api/v1/copytrade/vaults/${leaderId}/executions`,
      { limit },
    );
    return response.executions;
  }

  async depositToVault(
    leaderId: string,
    input: CopytradeSignedDepositInput,
  ): Promise<CopytradeDepositResult> {
    return this.http.post(
      `/api/v1/copytrade/vaults/${leaderId}/deposit`,
      input,
    );
  }

  async withdrawFromVault(
    leaderId: string,
    input: CopytradeSignedWithdrawInput,
  ): Promise<CopytradeWithdrawResult> {
    return this.http.post(
      `/api/v1/copytrade/vaults/${leaderId}/withdraw`,
      input,
    );
  }

  async createApiKeyChallenge(
    leaderId: string,
    leaderAddress: string,
  ): Promise<CopytradeApiKeyChallenge> {
    return this.http.get(
      `/api/v1/copytrade/leaders/${leaderId}/api-key/challenge`,
      { leaderAddress },
    );
  }

  async rotateApiKey(
    leaderId: string,
    input: { leaderAddress: string; challengeId: string; signature: string },
  ): Promise<CopytradeApiKeyResult> {
    return this.http.post(
      `/api/v1/copytrade/leaders/${leaderId}/api-key`,
      input,
    );
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

  async confirmWalletSignal(
    leaderId: string,
    signalId: string,
    input: CopytradeConfirmWalletSignalInput,
  ): Promise<CopytradeConfirmWalletSignalResult> {
    return this.http.post(
      `/api/v1/copytrade/vaults/${leaderId}/signals/${signalId}/wallet-confirmation`,
      input,
    );
  }

  async getPendingWalletSignals(
    leaderId: string,
    limit = 50,
    options?: { apiKey?: string },
  ): Promise<CopytradePendingWalletSignal[]> {
    const response = await this.http.get<{
      available: boolean;
      pending: CopytradePendingWalletSignal[];
    }>(
      `/api/v1/copytrade/vaults/${leaderId}/signals/pending-wallet`,
      { limit },
      options,
    );
    return response.pending;
  }
}
