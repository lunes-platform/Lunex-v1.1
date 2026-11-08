'use strict';

/** "250.5" with 6 decimals -> 250500000n. Throws on malformed / negative / too-precise input. */
function parseUnits(value, decimals) {
  const s = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid amount "${value}"`);
  const [int, frac = ''] = s.split('.');
  if (frac.length > decimals) throw new Error(`amount "${value}" has more than ${decimals} decimals`);
  return BigInt(int) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}

/** 250500000n with 6 decimals -> "250.5". */
function formatUnits(amount, decimals) {
  const base = 10n ** BigInt(decimals);
  const v = BigInt(amount);
  const int = v / base;
  const frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int.toString();
}

module.exports = { parseUnits, formatUnits };
