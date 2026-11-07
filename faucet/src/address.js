'use strict';

const { decodeAddress } = require('@polkadot/util-crypto');

/** Valid ss58 (checksum verified) 32-byte account address. */
function isValidAddress(address) {
  if (typeof address !== 'string') return false;
  const a = address.trim();
  if (a.length < 46 || a.length > 50 || a !== address) return false;
  try {
    return decodeAddress(a).length === 32;
  } catch {
    return false;
  }
}

module.exports = { isValidAddress };
