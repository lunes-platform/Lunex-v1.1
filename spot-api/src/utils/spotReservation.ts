import { Decimal } from '@prisma/client/runtime/library';
const Money = Decimal.clone({ precision: 80 });
const NATIVE_ASSET = '0x' + '00'.repeat(32);

export function spotAssetKey(address: string, isNative = false): string {
  return isNative ? NATIVE_ASSET : address;
}

export function toSpotUnits(amount: string, decimals: number): bigint {
  const raw = new Money(amount).mul(new Money(10).pow(decimals));
  if (
    !raw.isInteger() ||
    raw.isNegative() ||
    raw.gt(((1n << 128n) - 1n).toString())
  ) {
    throw new Error('Amount cannot be represented exactly in token units');
  }
  return BigInt(raw.toFixed(0));
}

export function quoteReserveUnits(
  price: string,
  amount: string,
  pair: { quoteDecimals: number; makerFeeBps?: number; takerFeeBps?: number },
): bigint {
  const principal = new Money(price)
    .mul(amount)
    .mul(new Money(10).pow(pair.quoteDecimals))
    .ceil();
  const maxFeeBps = Math.max(pair.makerFeeBps ?? 0, pair.takerFeeBps ?? 0);
  const fee = principal.mul(maxFeeBps).div(10000).ceil();
  return BigInt(principal.plus(fee).toFixed(0));
}

export function spotUnitsToDecimal(units: bigint, decimals: number): Decimal {
  return new Money(units.toString()).div(new Money(10).pow(decimals));
}
