/**
 * Pure helpers for normalizing on-chain pair reserves before
 * price/impact calculations.
 *
 * Contracts store reserves in canonical order (token_0 < token_1 by address).
 * UI callers may supply tokens in any order; these helpers align both the
 * reserve orientation and the decimal scale so that displayed prices and
 * computed price-impact reflect real economic values.
 *
 * No runtime imports — pure bigint arithmetic only.
 */

/**
 * Align reserve0/reserve1 (canonical contract order) to the swap path so
 * that reserveIn corresponds to path[0] and reserveOut to path[1].
 *
 * @param pairToken0  - canonical token_0 address returned by the pair contract
 * @param pathToken0  - path[0], i.e. the token the user is selling
 * @param reserve0Raw - raw u128 string for the canonical token_0 reserve
 * @param reserve1Raw - raw u128 string for the canonical token_1 reserve
 */
export function normalizeReservesForPath(
  pairToken0: string,
  pathToken0: string,
  reserve0Raw: string,
  reserve1Raw: string,
): { reserveIn: bigint; reserveOut: bigint } {
  const isPathToken0 =
    pathToken0.toLowerCase() === pairToken0.toLowerCase();

  if (isPathToken0) {
    return {
      reserveIn: BigInt(reserve0Raw),
      reserveOut: BigInt(reserve1Raw),
    };
  }

  // path[0] is the canonical token_1 → swap the reserves
  return {
    reserveIn: BigInt(reserve1Raw),
    reserveOut: BigInt(reserve0Raw),
  };
}

/**
 * Return the human-readable price of 1 unit of `displayToken` expressed in
 * the other token of the pair, with decimal adjustment applied.
 *
 * Background: reserves are raw integers (e.g. 7_679_233_508 for WLUNES with
 * 8 decimals, 81_660_345_758 for LUSDT with 6 decimals). A naive ratio gives
 * ~10.63, whereas the real price is ~1063.39 because of the 100× difference
 * in decimal scale (10^(8-6) = 100).
 *
 * To avoid Number precision loss on large u128 reserves the ratio is computed
 * entirely in bigint, scaled by 1e9, and only converted to Number at the last
 * step (9 significant decimal places are preserved).
 *
 * @param pairToken0   - canonical token_0 address returned by the pair contract
 * @param displayToken - the token whose price is being queried (e.g. tokenA selected in the UI)
 * @param reserve0Raw  - raw u128 string for the canonical token_0 reserve
 * @param reserve1Raw  - raw u128 string for the canonical token_1 reserve
 * @param decimals0    - decimal places of the canonical token_0
 * @param decimals1    - decimal places of the canonical token_1
 */
export function humanPrice(
  pairToken0: string,
  displayToken: string,
  reserve0Raw: string,
  reserve1Raw: string,
  decimals0: number,
  decimals1: number,
): number {
  const r0 = BigInt(reserve0Raw);
  const r1 = BigInt(reserve1Raw);

  if (r0 === 0n || r1 === 0n) return 0;

  // 9-decimal intermediate scale to preserve precision through the division
  const SCALE = BigInt(1_000_000_000);

  const isDisplayToken0 =
    displayToken.toLowerCase() === pairToken0.toLowerCase();

  if (isDisplayToken0) {
    // price of 1 token_0 in token_1
    // = (r1 / 10^decimals1) / (r0 / 10^decimals0)
    // = (r1 * 10^decimals0) / (r0 * 10^decimals1)
    const d0 = BigInt(10 ** decimals0);
    const d1 = BigInt(10 ** decimals1);
    const scaledNum = (r1 * d0 * SCALE) / (r0 * d1);
    return Number(scaledNum) / 1e9;
  }

  // price of 1 token_1 in token_0
  // = (r0 / 10^decimals0) / (r1 / 10^decimals1)
  // = (r0 * 10^decimals1) / (r1 * 10^decimals0)
  const d0 = BigInt(10 ** decimals0);
  const d1 = BigInt(10 ** decimals1);
  const scaledNum = (r0 * d1 * SCALE) / (r1 * d0);
  return Number(scaledNum) / 1e9;
}
