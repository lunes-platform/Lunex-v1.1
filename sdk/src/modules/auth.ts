import { HttpClient } from '../http-client';
import { AuthTokens } from '../types';
import { EndpointNotAvailableError } from '../errors';

export class AuthModule {
  constructor(private http: HttpClient) {}

  /**
   * Get a nonce for wallet signature
   * @param _address - Wallet address
   * @returns Nonce and expiration time
   * @deprecated spot-api does not expose `/auth/*` endpoints (this call
   * always returned HTTP 404). There is no session/login flow: wallet
   * mutations are authenticated per request with an sr25519 signature +
   * nonce inside the payload, and AI-agent routes use the `X-API-Key`
   * header (see `sdk.agents`). Always throws
   * {@link EndpointNotAvailableError}.
   */
  async getNonce(
    _address: string,
  ): Promise<{ nonce: string; expiresIn: number }> {
    throw new EndpointNotAvailableError(
      'auth.getNonce',
      'spot-api has no /auth/nonce endpoint. Authentication is per-request: sign each action with the wallet (sr25519 signature + nonce in the payload) or use an agent API key (X-API-Key).',
    );
  }

  /**
   * Authenticate with signed nonce
   * @param _address - Wallet address
   * @param _signature - Signed nonce
   * @param _nonce - Original nonce
   * @returns Authentication tokens
   * @deprecated spot-api does not expose `/auth/*` endpoints and never
   * issued session tokens (this call always returned HTTP 404). Sign each
   * wallet action per request (sr25519 signature + nonce) or use an agent
   * API key. Always throws {@link EndpointNotAvailableError}.
   */
  async login(
    _address: string,
    _signature: string,
    _nonce: string,
  ): Promise<AuthTokens> {
    throw new EndpointNotAvailableError(
      'auth.login',
      'spot-api has no /auth/login endpoint and does not issue session tokens. Sign each wallet action per request (sr25519 signature + nonce) or use an agent API key (X-API-Key).',
    );
  }

  /**
   * Refresh access token
   * @param _refreshToken - Refresh token
   * @returns New authentication tokens
   * @deprecated spot-api does not expose `/auth/*` endpoints and never
   * issued refresh tokens (this call always returned HTTP 404). Always
   * throws {@link EndpointNotAvailableError}.
   */
  async refreshToken(_refreshToken: string): Promise<AuthTokens> {
    throw new EndpointNotAvailableError(
      'auth.refreshToken',
      'spot-api has no /auth/refresh endpoint and does not issue session tokens. Sign each wallet action per request (sr25519 signature + nonce) or use an agent API key (X-API-Key).',
    );
  }

  /**
   * Logout and clear tokens
   */
  logout(): void {
    this.http.clearAuthToken();
  }
}
