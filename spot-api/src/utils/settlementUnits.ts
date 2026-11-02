const MAX_BALANCE = (1n << 128n) - 1n;

export function toSettlementOrderPriceUnits(
  order: { type: string; side: string; price: string },
  pair: { baseDecimals: number; quoteDecimals?: number },
): string {
  // A market order authorizes execution at book prices. Keep this bound
  // constant across partial fills so the attested order hash stays stable.
  if (order.type === 'MARKET' || order.type === 'STOP') {
    return order.side === 'BUY' ? MAX_BALANCE.toString() : '0';
  }
  return toSettlementPriceUnits(order.price, pair);
}

/** SpotSettlement prices express the raw quote/base ratio scaled by 1e8. */
export function toSettlementPriceUnits(
  price: string,
  pair: { baseDecimals: number; quoteDecimals?: number },
): string {
  const { baseDecimals, quoteDecimals } = pair;
  if (quoteDecimals === undefined) {
    throw new Error('Missing quote decimals in settlement snapshot');
  }
  if (
    ![baseDecimals, quoteDecimals].every(
      (value) => Number.isInteger(value) && value >= 0 && value <= 255,
    )
  ) {
    throw new Error('Invalid token decimals in settlement snapshot');
  }
  const match = price.trim().match(/^\+?(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if (!match || (!match[1] && !match[2]))
    throw new Error('Invalid settlement price');
  const fraction = match[2] || '';
  let digits = (match[1] + fraction).replace(/^0+/, '');
  if (!digits) throw new Error('Settlement price must be positive');
  const exponent =
    Number(match[3] || '0') -
    fraction.length +
    8 +
    quoteDecimals -
    baseDecimals;
  if (!Number.isSafeInteger(exponent))
    throw new Error('Invalid settlement price exponent');

  if (exponent < 0) {
    const cut = -exponent;
    if (cut >= digits.length || /[^0]/.test(digits.slice(-cut))) {
      throw new Error(
        'Price cannot be represented exactly for this token pair',
      );
    }
    digits = digits.slice(0, -cut);
  } else {
    if (digits.length + exponent > 39)
      throw new Error('Settlement price exceeds u128');
    digits += '0'.repeat(exponent);
  }
  const units = BigInt(digits);
  if (units > MAX_BALANCE) throw new Error('Settlement price exceeds u128');
  return units.toString();
}
