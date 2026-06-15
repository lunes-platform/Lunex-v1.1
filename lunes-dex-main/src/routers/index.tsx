import { Suspense, lazy } from 'react'
import { Route, Routes } from 'react-router-dom'

// Route-based code splitting: each page is loaded on demand so a given route
// does not download the entire app bundle. The app shell (Header, providers,
// theme) stays eager via App.tsx / index.tsx — only page bodies are lazy.
const Home = lazy(() => import('pages/home'))
const Pool = lazy(() => import('pages/pool'))
const AsymmetricPool = lazy(() => import('pages/pool/asymmetric'))
const Pools = lazy(() => import('pages/pools'))
const Staking = lazy(() => import('pages/staking'))
const Rewards = lazy(() => import('pages/rewards'))
const Listing = lazy(() => import('pages/listing'))
const Governance = lazy(() => import('pages/governance'))
const Landing = lazy(() => import('pages/landing'))
const Spot = lazy(() => import('pages/spot'))
const Copytrade = lazy(() => import('pages/copytrade'))
const SocialTrade = lazy(() => import('pages/social'))
const SocialProfile = lazy(() => import('pages/social/Profile'))
const SocialSettings = lazy(() => import('pages/social/settings'))
const BotRegistry = lazy(() => import('pages/social/BotRegistry'))
const Docs = lazy(() => import('pages/docs'))
const Affiliates = lazy(() => import('pages/affiliates'))
const ProtocolStats = lazy(() => import('pages/protocolStats'))
const StrategyMarketplace = lazy(() => import('pages/strategies'))
const StrategyDetail = lazy(() => import('pages/strategies/Detail'))
const AgentDashboard = lazy(() => import('pages/agent'))
const AgentGetStarted = lazy(() => import('pages/agents/GetStarted'))
const NotFound = lazy(() => import('pages/notFound'))

const RouteFallback = () => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      color: '#8a8f98',
      fontSize: '0.9rem'
    }}
    role="status"
    aria-live="polite"
  >
    Loading…
  </div>
)

const AppRoutes = () => {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/swap" element={<Home />} />
        <Route path="/trade" element={<Home />} />
        <Route path="/pool" element={<Pool />} />
        <Route path="/pool/asymmetric" element={<AsymmetricPool />} />
        <Route path="/pools" element={<Pools />} />
        <Route path="/liquidity" element={<Pools />} />
        <Route path="/staking" element={<Staking />} />
        <Route path="/stake" element={<Staking />} />
        <Route path="/rewards" element={<Rewards />} />
        <Route path="/community" element={<Rewards />} />
        <Route path="/listing" element={<Listing />} />
        <Route path="/governance" element={<Governance />} />
        <Route path="/spot" element={<Spot />} />
        <Route path="/spot/copytrade" element={<Copytrade />} />
        <Route path="/social" element={<SocialTrade />} />
        <Route path="/social/profile/:id" element={<SocialProfile />} />
        <Route path="/social/settings" element={<SocialSettings />} />
        <Route path="/social/bots" element={<BotRegistry />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/affiliates" element={<Affiliates />} />
        <Route path="/referral" element={<Affiliates />} />
        <Route path="/protocol-stats" element={<ProtocolStats />} />
        <Route path="/strategies" element={<StrategyMarketplace />} />
        <Route path="/strategies/:id" element={<StrategyDetail />} />
        <Route path="/agent" element={<AgentDashboard />} />
        <Route path="/agents/get-started" element={<AgentGetStarted />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}

export default AppRoutes
