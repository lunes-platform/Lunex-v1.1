import { HttpClient } from '../http-client';
import { AuthTokens } from '../types';

export class AuthModule {
  constructor(private http: HttpClient) {}

  /**
   * Get a nonce for wallet signature
   * @param address - Wallet address
   * @returns Nonce and expiration time
   */
  async getNonce(
    address: string,
  ): Promise<{ nonce: string; expiresIn: number }> {
    return this.http.post('/auth/nonce', { address });
  }

  /**
   * Authenticate with signed nonce
   * @param address - Wallet address
   * @param signature - Signed nonce
   * @param nonce - Original nonce
   * @returns Authentication tokens
   */
  async login(
    address: string,
    signature: string,
    nonce: string,
  ): Promise<AuthTokens> {
    const tokens = await this.http.post<AuthTokens>('/auth/login', {
      address,
      signature,
      nonce,
    });

    this.http.setAuthToken(tokens.token);
    return tokens;
  }

  /**
   * Refresh access token
   * @param refreshToken - Refresh token
   * @returns New authentication tokens
   */
  async refreshToken(refreshToken: string): Promise<AuthTokens> {
    const tokens = await this.http.post<AuthTokens>('/auth/refresh', {
      refreshToken,
    });

    this.http.setAuthToken(tokens.token);
    return tokens;
  }

  /**
   * Logout and clear tokens
   */
  logout(): void {
    this.http.clearAuthToken();
  }
}
