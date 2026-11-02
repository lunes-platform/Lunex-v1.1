import { decodeAddress } from '@polkadot/util-crypto';

type ContractOutput = {
  toJSON?: () => unknown;
  toString: () => string;
};

function unwrapContractOutput(output: ContractOutput): unknown {
  let value: unknown = output.toJSON ? output.toJSON() : output.toString();
  while (value && typeof value === 'object') {
    const envelope = value as Record<string, unknown>;
    if ('err' in envelope || 'Err' in envelope) {
      throw new Error('Contract query returned an error');
    }
    if ('ok' in envelope) value = envelope.ok;
    else if ('Ok' in envelope) value = envelope.Ok;
    else break;
  }
  return value;
}

export function readContractBalance(output: ContractOutput): bigint {
  const value = unwrapContractOutput(output);
  if (
    !['string', 'number', 'bigint'].includes(typeof value) ||
    (typeof value === 'string' && value.trim().length === 0) ||
    (typeof value === 'number' && !Number.isSafeInteger(value))
  ) {
    throw new Error('Invalid contract balance response');
  }
  const balance = BigInt(value as string | number | bigint);
  if (balance < 0n) throw new Error('Invalid negative contract balance');
  return balance;
}

export function readContractBoolean(output: ContractOutput): boolean {
  const value = unwrapContractOutput(output);
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error('Invalid contract boolean response');
}

export function readContractOptionalAccount(
  output: ContractOutput,
): string | null {
  let value = unwrapContractOutput(output);
  if (value && typeof value === 'object' && 'some' in value) {
    value = (value as { some: unknown }).some;
  }
  if (value === null || value === 'None' || value === 'null') return null;
  if (typeof value !== 'string' || decodeAddress(value).length !== 32) {
    throw new Error('Invalid contract account response');
  }
  return value;
}
