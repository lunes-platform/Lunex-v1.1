import { Route, Routes } from 'react-router-dom'

import Home from 'pages/home'
import Pool from 'pages/pool'
import AsymmetricPool from 'pages/pool/asymmetric'
import Pools from 'pages/pools'
import Staking from 'pages/staking'
import Rewards from 'pages/rewards'
import Listing from 'pages/listing'
import Governance from 'pages/governance'
import Landing from 'pages/landing'
import Spot from 'pages/spot'
import Copytrade from 'pages/copytrade'
import SocialTrade from 'pages/social'
import SocialProfile from 'pages/social/Profile'
import SocialSettings from 'pages/social/settings'
import BotRegistry from 'pages/social/BotRegistry'
import LayoutDefault from '../components/layout'
import Docs from 'pages/docs'
import Affiliates from 'pages/affiliates'
import ProtocolStats from 'pages/protocolStats'

const AppRoutes = () => {
  return (
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
    </Routes>
  )
}

export default AppRoutes
