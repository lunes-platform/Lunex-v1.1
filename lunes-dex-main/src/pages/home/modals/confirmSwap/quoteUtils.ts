/**
 * Pure utility functions for the Confirm Swap modal.
 *
 * LP fee constant anchored to pair/lib.rs:
 *   LP_FEE_SHARE = 600 out of 1000 total fee shares
 *   Total swap fee = 0.5% (995/1000 numerator)
 *   LP share = 60% of total fee = 0.3% of trade amount
 */

const LP_FEE_RATE = 0.003; // 0.3% — pair/lib.rs LP_FEE_SHARE=600 (60% of 0.5% total)

/**
 * Computes the Liquidity Provider fee for a given input amount.
 * Result is LP_FEE_RATE (0.3%) of the input, formatted to `decimals` places
 * with trailing zeros stripped.
 */
export function computeLpFee(
  inputAmount: string,
  decimals: number,
): string {
  if (!inputAmount || inputAmount === '0') return '0';
  const parsed = parseFloat(inputAmount);
  if (isNaN(parsed) || parsed === 0) return '0';
  return (parsed * LP_FEE_RATE)
    .toFixed(decimals)
    .replace(/\.?0+$/, '');
}

/**
 * Returns true when the modal has a usable quote to gate the confirm button.
 * Only minimumReceived is checked — priceImpact of '0' is a valid same-block
 * result and must NOT block confirmation.
 */
export function isQuoteReady(
  minimumReceived: string | undefined,
  _priceImpact: string | undefined,
): boolean {
  return (
    typeof minimumReceived === 'string' &&
    minimumReceived !== '' &&
    minimumReceived !== '0'
  );
}
