import { config } from '../../config';

export function buildSignedBody<T extends Record<string, unknown>>(
  fields: T,
): T & {
  nonce: string;
  timestamp: number;
  signature: string;
} {
  const timestamp = Date.now();

  return {
    ...fields,
    nonce: `test-nonce-${timestamp}`,
    timestamp,
    signature: 'signed-payload',
  };
}

export function buildSignedQuery(
  addressField: string,
  address: string,
  fields: Record<string, string | number | undefined> = {},
) {
  const timestamp = Date.now();

  return {
    [addressField]: address,
    ...fields,
    nonce: `test-nonce-${timestamp}`,
    timestamp,
    signature: 'signed-payload',
  };
}

export const ADMIN_AUTH_HEADER = {
  Authorization: `Bearer ${config.adminSecret}`,
};
