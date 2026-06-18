import { decodeAddress } from '@polkadot/util-crypto'

/**
 * True only for a syntactically valid SS58/Substrate address.
 *
 * The contract layer calls `createType('AccountId', addr)` under the hood,
 * which throws `createType(AccountId): Invalid base58 ...` on malformed input
 * (the native `'native'` sentinel, an unconfigured/empty token address, or any
 * non-base58 string). Guarding with this helper lets callers degrade to a clean
 * "no pair / insufficient liquidity" state instead of surfacing a decode crash.
 */
export const isValidSubstrateAddress = (
  addr: string | null | undefined,
): addr is string => {
  if (!addr || typeof addr !== 'string') return false
  try {
    // ignoreChecksum: the crash we guard against is the base58 *decode* failure
    // inside createType('AccountId', addr). Skipping the blake2 checksum keeps
    // this pure base58/length validation — no wasm-crypto init required, so it
    // behaves identically in the browser and in jsdom tests.
    decodeAddress(addr, true)
    return true
  } catch {
    return false
  }
}
