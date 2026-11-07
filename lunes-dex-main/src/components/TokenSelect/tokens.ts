/**
 * Swap token list. Source of truth is `chooseToken/tokenRegistry` (env-driven
 * addresses, unconfigured tokens filtered out). Native LUNES is listed first
 * and routed to WLUNES by `utils/nativeToken`; WLUNES stays selectable so
 * wrap/unwrap is reachable. Live USD prices come from `useTokenPrices`.
 */
import { searchableTokens } from 'pages/home/modals/chooseToken/tokenRegistry'

export type { Token } from 'pages/home/modals/chooseToken/tokenRegistry'

export default searchableTokens
