'use strict';

/**
 * Well-known Substrate development keys. Anything derived from the public dev
 * phrase is world-readable: a faucet funded by one of these can be drained by
 * anybody, so they are refused in production.
 */
const DEV_PHRASE = 'bottom drive obey lake curtain smoke basket hold race lonely fit walk';

// sr25519 mini-secrets / raw seeds commonly published alongside the dev keys.
const DEV_RAW_SEEDS = new Set([
  '0xfac7959dbfe72f052e5a0c3c8d6530f202b02fd8f9f5ca3580ec8deb7797479e', // dev phrase
  '0xe5be9a5092b81bca64be81d212e7f2f9eba183bb7a90954f7b76361f6edb5c0a', // //Alice
  '0x398f0c28f98885e046333d4a41c19cee4c37368a9832c6502f6cfd182e2aef89', // //Bob
]);

// Addresses (ss58 prefix 42) of the dev phrase and its //Name derivations.
const DEV_ADDRESSES = new Set([
  '5DfhGyQdFobKM8NsWvEeAKk5EQQgYe9AydgJ7rMB6E1EqRzV', // dev phrase root
  '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', // Alice
  '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty', // Bob
  '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y', // Charlie
  '5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy', // Dave
  '5HGjWAeFDfFCWPsjFQdVV2Msvz2XtMktvgocEZcCj68kUMaw', // Eve
  '5CiPPseXPECbkjWCa6MnjNokrgYjMqmKndv2rSnekmSK2DjL', // Ferdie
]);

function normalizeSeed(seed) {
  return String(seed || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** True for `//Anything` (= dev phrase + derivation), the dev phrase itself, or a published raw dev seed. */
function isWellKnownDevSeed(seed) {
  const s = normalizeSeed(seed);
  if (!s) return false;
  if (s.startsWith('//') || s.startsWith('/')) return true;
  if (s.startsWith(DEV_PHRASE)) return true;
  return DEV_RAW_SEEDS.has(s);
}

function isWellKnownDevAddress(address) {
  return DEV_ADDRESSES.has(String(address || '').trim());
}

module.exports = { isWellKnownDevSeed, isWellKnownDevAddress, DEV_PHRASE };
