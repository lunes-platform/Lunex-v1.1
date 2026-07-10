// Route chunk prefetching.
//
// Each entry mirrors a React.lazy(() => import(...)) target in ./index.tsx.
// Calling a prefetcher kicks off the dynamic import for that route's chunk so
// it is already in the browser cache by the time the user clicks the nav link —
// turning a click-then-wait into an instant navigation. The dynamic import()
// promise is cached by the bundler/browser, so repeated hovers are free and
// this never double-downloads a chunk.
//
// Keep the keys in sync with the menu items in pages/header/index.tsx.

type Prefetcher = () => Promise<unknown>

const prefetchers: Record<string, Prefetcher> = {
  '/swap': () => import('pages/home'),
  '/trade': () => import('pages/home'),
  '/spot': () => import('pages/spot'),
  '/pools': () => import('pages/pools'),
  '/pool': () => import('pages/pool'),
  '/liquidity': () => import('pages/pools'),
  '/staking': () => import('pages/staking'),
  '/stake': () => import('pages/staking'),
  '/social': () => import('pages/social'),
  '/strategies': () => import('pages/strategies'),
  '/agent': () => import('pages/agent'),
  '/rewards': () => import('pages/rewards'),
  '/affiliates': () => import('pages/affiliates'),
  '/governance': () => import('pages/governance'),
  '/protocol-stats': () => import('pages/protocolStats'),
  '/docs': () => import('pages/docs'),
}

// Tracks paths already prefetched in this session to avoid re-invoking import()
// on every mouseenter (the bundler caches anyway, but this skips the call).
const prefetched = new Set<string>()

/**
 * Prefetch the lazy chunk for a route path. Safe to call on every hover —
 * no-ops for unknown paths and only triggers the import once per path.
 * Failures are swallowed: prefetch is a best-effort optimisation and must
 * never break navigation.
 */
export const prefetchRoute = (path: string): void => {
  if (prefetched.has(path)) return
  const load = prefetchers[path]
  if (!load) return
  prefetched.add(path)
  try {
    void load().catch(() => {
      // Allow a later real navigation to retry the import.
      prefetched.delete(path)
    })
  } catch {
    prefetched.delete(path)
  }
}
