import React, { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { useNavigate } from 'react-router-dom'

const BookIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
  </svg>
)
const RocketIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M4.5 16.5c-1.5 1.5-2 4.5-2 4.5s3-.5 4.5-2c1.5-1.5 2-4.5 2-4.5s-3 .5-4.5 2z" />
    <path d="M14 9l1-4 4-1-1 4-4 1z" />
    <path d="M15 4l5 5" />
    <path d="M9 15l-5 5" />
    <path d="M5 19l-1-1" />
    <path d="M9 7c3.5-3.5 8-4 11-4 0 3-.5 7.5-4 11-2.5 2.5-6.5 3-9 3 0-2.5.5-6.5 3-9z" />
  </svg>
)
const TradeIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <polyline points="17 1 21 5 17 9" />
    <path d="M3 11V9a4 4 0 014-4h14" />
    <polyline points="7 23 3 19 7 15" />
    <path d="M21 13v2a4 4 0 01-4 4H3" />
  </svg>
)
const DropIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z" />
  </svg>
)
const SocialIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 00-3-3.87" />
    <path d="M16 3.13a4 4 0 010 7.75" />
  </svg>
)
const CodeIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
)
const ShieldIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
)
const HelpIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 115.82 1c0 2-3 3-3 3" />
    <path d="M12 17h.01" />
  </svg>
)
const CopyIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
)
const SearchIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <circle cx="11" cy="11" r="8" />
    <path d="M21 21l-4.35-4.35" />
  </svg>
)
const ArrowIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
)

type Section =
  | 'overview'
  | 'getting-started'
  | 'trading'
  | 'copytrade'
  | 'liquidity'
  | 'developers'
  | 'security'
  | 'faq'

interface NavItem {
  id: Section
  label: string
  description: string
  audience: string
  icon: React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    description:
      'Full ecosystem overview and how to navigate the Lunex platform.',
    audience: 'Everyone',
    icon: <BookIcon />
  },
  {
    id: 'getting-started',
    label: 'Getting Started',
    description:
      'Practical checklist to connect your wallet, set up the network, and prepare your first trade.',
    audience: 'Users',
    icon: <RocketIcon />
  },
  {
    id: 'trading',
    label: 'Trading',
    description:
      'Swap, Spot and Margin with best practices for safer and more efficient trading.',
    audience: 'Traders',
    icon: <TradeIcon />
  },
  {
    id: 'copytrade',
    label: 'Social & Copytrade',
    description:
      'How to follow leaders, assess risk and use vaults with better judgment.',
    audience: 'Investors',
    icon: <SocialIcon />
  },
  {
    id: 'liquidity',
    label: 'Liquidity & Rewards',
    description:
      'Add liquidity, understand risk and take advantage of staking and incentives.',
    audience: 'LPs',
    icon: <DropIcon />
  },
  {
    id: 'developers',
    label: 'Developers',
    description:
      'Integration via SDK, frontend services, spot API and MCP for automation.',
    audience: 'Builders',
    icon: <CodeIcon />
  },
  {
    id: 'security',
    label: 'Security',
    description: 'Approvals, slippage, seed phrases and recommended practices.',
    audience: 'Everyone',
    icon: <ShieldIcon />
  },
  {
    id: 'faq',
    label: 'FAQ & Support',
    description: 'Frequently asked questions, troubleshooting and support channels.',
    audience: 'Everyone',
    icon: <HelpIcon />
  }
]

const SECTION_INTRO: Record<Section, { title: string; description: string }> = {
  overview: {
    title: 'Overview',
    description:
      'Quickly understand where each Lunex product fits and which flow to follow based on your goals.'
  },
  'getting-started': {
    title: 'Getting Started',
    description:
      'Complete your initial setup with less friction and avoid the most common mistakes before your first trade.'
  },
  trading: {
    title: 'Trading',
    description:
      'Use Swap, Spot and Margin with a more professional, predictable and risk-oriented workflow.'
  },
  copytrade: {
    title: 'Social & Copytrade',
    description:
      'Learn how to evaluate leaders, understand vaults and track performance with greater clarity.'
  },
  liquidity: {
    title: 'Liquidity & Rewards',
    description:
      'Learn when providing liquidity makes sense and how to combine it with staking and incentive programs.'
  },
  developers: {
    title: 'Developers',
    description:
      'Connect applications, bots and AI agents to the Lunex ecosystem using available integration surfaces.'
  },
  security: {
    title: 'Security',
    description:
      'Best practices for wallet management, permissions, slippage, token validation and operational hygiene.'
  },
  faq: {
    title: 'FAQ & Support',
    description:
      'Straightforward answers to common questions and guidance for problem resolution.'
  }
}

const Page = styled.div`
  min-height: 100vh;
  background: #121214;
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr) 280px;
  padding-top: 64px;
  font-family: 'Space Grotesk', sans-serif;

  @media (max-width: 1180px) {
    grid-template-columns: 280px minmax(0, 1fr);
  }

  @media (max-width: 920px) {
    display: block;
  }
`

const Sidebar = styled.aside`
  background: #17171a;
  border-right: 1px solid #26262b;
  padding: 28px 20px;
  position: sticky;
  top: 64px;
  height: calc(100vh - 64px);
  overflow-y: auto;
  min-width: 0;

  @media (max-width: 920px) {
    position: static;
    height: auto;
    border-right: none;
    border-bottom: 1px solid #26262b;
  }
`

const SidebarTitle = styled.div`
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1.1px;
  color: #8e61ff;
  margin-bottom: 10px;
`

const SidebarIntro = styled.p`
  margin: 0 0 20px;
  font-size: 13px;
  line-height: 1.6;
  color: #8f8f98;
`

const SearchBox = styled.label`
  display: flex;
  align-items: center;
  gap: 10px;
  background: #0d0d0f;
  border: 1px solid #2a2a30;
  border-radius: 12px;
  padding: 12px 14px;
  color: #70707b;
  margin-bottom: 18px;
`

const SearchInput = styled.input`
  border: none;
  outline: none;
  background: transparent;
  color: #ffffff;
  width: 100%;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;

  &::placeholder {
    color: #6f6f79;
  }
`

const SidebarItem = styled.button<{ active: boolean }>`
  width: 100%;
  min-width: 0;
  overflow: visible;
  white-space: normal;
  border: 1px solid
    ${({ active }) => (active ? 'rgba(142,97,255,0.35)' : 'transparent')};
  background: ${({ active }) =>
    active
      ? 'linear-gradient(180deg, rgba(142,97,255,0.16), rgba(142,97,255,0.08))'
      : 'transparent'};
  color: ${({ active }) => (active ? '#F5F1FF' : '#A0A0AB')};
  border-radius: 14px;
  padding: 14px;
  text-align: left;
  cursor: pointer;
  transition: all 0.18s ease;
  margin-bottom: 10px;

  &:hover {
    border-color: rgba(142, 97, 255, 0.25);
    background: rgba(142, 97, 255, 0.08);
    color: #ffffff;
  }
`

const SidebarItemHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
  font-size: 14px;
  font-weight: 700;
  min-width: 0;
  flex-wrap: wrap;
`

const SidebarItemDescription = styled.div`
  font-size: 12px;
  line-height: 1.55;
  color: #7d7d87;
  overflow-wrap: break-word;
  word-break: break-word;
`

const AudienceBadge = styled.span`
  margin-left: auto;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: #b7b7c2;
  border-radius: 999px;
  padding: 4px 8px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.35px;
  text-transform: uppercase;
`

const EmptyState = styled.div`
  border: 1px dashed #2c2c33;
  border-radius: 14px;
  padding: 18px;
  color: #8a8a95;
  font-size: 13px;
  line-height: 1.6;
`

const Main = styled.main`
  min-width: 0;
  padding: 40px 48px 64px;

  @media (max-width: 920px) {
    padding: 28px 20px 48px;
  }
`

const RightRail = styled.aside`
  border-left: 1px solid #26262b;
  padding: 28px 22px;
  position: sticky;
  top: 64px;
  height: calc(100vh - 64px);
  overflow-y: auto;
  background: #151517;
  min-width: 0;

  @media (max-width: 1180px) {
    display: none;
  }
`

const Hero = styled.section`
  border: 1px solid rgba(142, 97, 255, 0.16);
  background: radial-gradient(
      circle at top right,
      rgba(142, 97, 255, 0.18),
      transparent 32%
    ),
    linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.02),
      rgba(255, 255, 255, 0.01)
    );
  border-radius: 24px;
  padding: 30px;
  margin-bottom: 24px;
`

const Kicker = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(142, 97, 255, 0.12);
  color: #c9b8ff;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-bottom: 14px;
`

const H1 = styled.h1`
  font-size: 40px;
  line-height: 1.08;
  font-weight: 800;
  color: #ffffff;
  margin: 0 0 12px;

  span {
    background: linear-gradient(135deg, #8e61ff, #d1bfff);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  @media (max-width: 920px) {
    font-size: 32px;
  }
`

const Lead = styled.p`
  margin: 0;
  max-width: 760px;
  color: #b7b7c1;
  font-size: 16px;
  line-height: 1.75;
`

const CTAGroup = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 22px;
`

const CTAButton = styled.button<{ secondary?: boolean }>`
  border: 1px solid ${({ secondary }) => (secondary ? '#2D2D34' : '#00ff88')};
  background: ${({ secondary }) =>
    secondary ? '#1B1B20' : '#00ff88'};
  color: ${({ secondary }) => (secondary ? '#ffffff' : '#000000')};
  border-radius: 12px;
  padding: 12px 16px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  font-weight: 700;
  transition: transform 0.15s ease, opacity 0.15s ease;

  &:hover {
    transform: translateY(-1px);
    opacity: 0.9;
  }
`

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 24px;

  @media (max-width: 920px) {
    grid-template-columns: 1fr;
  }
`

const Card = styled.div<{ span?: number }>`
  grid-column: span ${({ span = 4 }) => span};
  border: 1px solid #27272e;
  background: #18181b;
  border-radius: 20px;
  padding: 20px;

  @media (max-width: 920px) {
    grid-column: span 1;
  }
`

const CardTitle = styled.h3`
  margin: 0 0 8px;
  color: #ffffff;
  font-size: 18px;
  font-weight: 700;
`

const CardText = styled.p`
  margin: 0;
  color: #a9a9b3;
  line-height: 1.7;
  font-size: 14px;
  overflow-wrap: break-word;
  word-break: break-word;
`

const StatsRow = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-top: 24px;

  @media (max-width: 920px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`

const StatCard = styled.div`
  border: 1px solid #26262d;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 16px;
  padding: 16px;
`

const StatValue = styled.div`
  color: #ffffff;
  font-size: 22px;
  font-weight: 800;
  margin-bottom: 6px;
`

const StatLabel = styled.div`
  color: #8b8b95;
  font-size: 12px;
  line-height: 1.5;
`

const H2 = styled.h2`
  font-size: 24px;
  font-weight: 700;
  color: #ffffff;
  margin: 32px 0 12px;
`

const H3 = styled.h3`
  font-size: 18px;
  font-weight: 700;
  color: #ffffff;
  margin: 22px 0 8px;
`

const P = styled.p`
  font-size: 15px;
  color: #b4b4be;
  line-height: 1.75;
  margin: 0 0 14px;
`

const InlineCode = styled.code`
  background: #232329;
  border: 1px solid #2b2b33;
  border-radius: 6px;
  padding: 2px 6px;
  font-size: 13px;
  font-family: 'JetBrains Mono', monospace;
  color: #d0beff;
`

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  margin: 14px 0 24px;
  overflow: hidden;

  th,
  td {
    padding: 12px 14px;
    text-align: left;
    border-bottom: 1px solid #2a2a31;
    font-size: 13px;
    vertical-align: top;
  }

  th {
    color: #8f8f99;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    font-size: 11px;
  }

  td {
    color: #e5e5ea;
    line-height: 1.6;
  }
`

const Callout = styled.div<{ variant?: 'default' | 'success' | 'warning' }>`
  border-radius: 16px;
  padding: 18px 20px;
  margin: 16px 0 24px;
  line-height: 1.7;
  font-size: 14px;
  border: 1px solid transparent;

  ${({ variant }) => {
    if (variant === 'success') {
      return 'background: rgba(38,208,124,0.08); border-color: rgba(38,208,124,0.18); color: #B7F3D3;'
    }
    if (variant === 'warning') {
      return 'background: rgba(255,178,71,0.08); border-color: rgba(255,178,71,0.18); color: #FFDCA7;'
    }
    return 'background: rgba(142,97,255,0.09); border-color: rgba(142,97,255,0.18); color: #D7C8FF;'
  }}
`

const Checklist = styled.ul`
  margin: 14px 0 24px;
  padding-left: 18px;
  color: #b7b7c1;

  li {
    margin-bottom: 10px;
    line-height: 1.7;
  }
`

const CodeBlock = styled.div`
  position: relative;
  background: #0b0b0d;
  border: 1px solid #24242a;
  border-radius: 16px;
  padding: 18px;
  margin: 14px 0 24px;
  overflow-x: auto;
`

const Pre = styled.pre`
  margin: 0;
  white-space: pre;
  color: #e5e5e7;
  font-size: 13px;
  line-height: 1.65;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
`

const CopyButton = styled.button`
  position: absolute;
  top: 10px;
  right: 10px;
  border: 1px solid #2c2c33;
  background: #17171b;
  color: #b8b8c2;
  border-radius: 10px;
  padding: 7px 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;

  &:hover {
    color: #ffffff;
    border-color: #41414a;
  }
`

const RailCard = styled.div`
  border: 1px solid #27272e;
  border-radius: 18px;
  background: #18181b;
  padding: 18px;
  margin-bottom: 16px;
`

const RailTitle = styled.div`
  color: #ffffff;
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 10px;
`

const RailText = styled.p`
  margin: 0;
  color: #a1a1ab;
  font-size: 13px;
  line-height: 1.65;
`

const RailList = styled.div`
  display: grid;
  gap: 10px;
`

const RailLink = styled.button`
  width: 100%;
  min-width: 0;
  overflow: visible;
  white-space: normal;
  border: 1px solid #2b2b31;
  background: #121216;
  color: #eaeaf0;
  border-radius: 12px;
  padding: 12px;
  text-align: left;
  font-family: 'Space Grotesk', sans-serif;
  cursor: pointer;

  &:hover {
    border-color: rgba(142, 97, 255, 0.3);
    color: #ffffff;
  }
`

const RailLinkLabel = styled.div`
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 4px;
`

const RailLinkDescription = styled.div`
  font-size: 12px;
  color: #8d8d97;
  line-height: 1.5;
  overflow-wrap: break-word;
  word-break: break-word;
`

const Steps = styled.div`
  display: grid;
  gap: 12px;
  margin: 14px 0 24px;
`

const Step = styled.div`
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
`

const StepNumber = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 12px;
  background: rgba(142, 97, 255, 0.14);
  color: #d8caff;
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 800;
`

const StepBody = styled.div`
  min-width: 0;
`

const StepTitle = styled.div`
  color: #ffffff;
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 4px;
`

const StepText = styled.div`
  color: #afafb8;
  font-size: 14px;
  line-height: 1.7;
`

const SectionDivider = styled.div`
  height: 1px;
  background: linear-gradient(
    90deg,
    rgba(142, 97, 255, 0.35),
    rgba(142, 97, 255, 0)
  );
  margin: 8px 0 28px;
`

const Code: React.FC<{ children: string }> = ({ children }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(children)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch (_error) {
      setCopied(false)
    }
  }

  return (
    <CodeBlock>
      <CopyButton onClick={handleCopy}>
        <CopyIcon />
        {copied ? 'Copied' : 'Copy'}
      </CopyButton>
      <Pre>{children}</Pre>
    </CodeBlock>
  )
}

const OverviewSection = () => (
  <>
    <H2>What is Lunex</H2>
    <P>
      Lunex combines decentralized exchange products with a more
      product-oriented experience: swap, spot, margin, copytrade, reward
      programs and surfaces for builders to integrate automation and AI agents.
      This documentation is designed to accelerate your path, whether you are an
      end user, liquidity provider, trader or developer.
    </P>

    <Grid>
      <Card>
        <CardTitle>For users</CardTitle>
        <CardText>
          Use this documentation to set up your wallet, understand products,
          trade with fewer errors and adopt a more professional daily workflow.
        </CardText>
      </Card>
      <Card>
        <CardTitle>For traders</CardTitle>
        <CardText>
          Compare Swap, Spot and Margin, understand slippage, liquidity,
          leverage risk and how to verify execution before confirming orders.
        </CardText>
      </Card>
      <Card>
        <CardTitle>For builders</CardTitle>
        <CardText>
          Use the <InlineCode>SDKContext</InlineCode>, integration services,
          the Spot API backend and the MCP agent to build automations and
          products.
        </CardText>
      </Card>
    </Grid>

    <H2>Quick product map</H2>
    <Table>
      <thead>
        <tr>
          <th>Area</th>
          <th>When to use</th>
          <th>Best for</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <InlineCode>/swap</InlineCode>
          </td>
          <td>Quick token exchange with a simple UX</td>
          <td>Users who want direct execution without advanced flows</td>
        </tr>
        <tr>
          <td>
            <InlineCode>/spot</InlineCode>
          </td>
          <td>Trading with a more detailed market view</td>
          <td>Active traders and more precise entry/exit strategies</td>
        </tr>
        <tr>
          <td>
            <InlineCode>/spot/copytrade</InlineCode>
          </td>
          <td>Follow leaders and participate in strategies via vaults</td>
          <td>Investors who prefer to delegate execution</td>
        </tr>
        <tr>
          <td>
            <InlineCode>/pools</InlineCode>
          </td>
          <td>Provide liquidity and browse available pools</td>
          <td>LPs focused on fee generation and incentives</td>
        </tr>
        <tr>
          <td>
            <InlineCode>/staking</InlineCode>
          </td>
          <td>Lock tokens for rewards</td>
          <td>Users with a more passive horizon</td>
        </tr>
        <tr>
          <td>
            <InlineCode>/docs</InlineCode>
          </td>
          <td>Operational and technical support</td>
          <td>All profiles</td>
        </tr>
      </tbody>
    </Table>

    <Callout>
      <strong>Pro tip:</strong> if you are just getting started, follow the order{' '}
      <InlineCode>
        wallet → network → small swap → spot/copytrade → larger strategies
      </InlineCode>
      . This reduces operational errors and helps validate each step with
      controlled risk.
    </Callout>

    <H2>What makes this documentation version more useful</H2>
    <Checklist>
      <li>
        Content reorganized by real use objective, not just by technical
        component.
      </li>
      <li>Operational checklists to reduce failures before transactions.</li>
      <li>
        Risk and security best practices written in more direct language.
      </li>
      <li>
        Clear shortcuts to product areas and for builders who want to
        integrate quickly.
      </li>
    </Checklist>
  </>
)

const GettingStartedSection = () => (
  <>
    <H2>Initial checklist</H2>
    <Steps>
      <Step>
        <StepNumber>1</StepNumber>
        <StepBody>
          <StepTitle>Connect a compatible wallet</StepTitle>
          <StepText>
            Have a wallet with Lunes/Substrate ecosystem support and confirm
            that the selected account is the correct one for signing transactions.
          </StepText>
        </StepBody>
      </Step>
      <Step>
        <StepNumber>2</StepNumber>
        <StepBody>
          <StepTitle>Validate the network and environment</StepTitle>
          <StepText>
            Use the appropriate RPC endpoint and verify you are on the expected
            environment before moving significant capital.
          </StepText>
        </StepBody>
      </Step>
      <Step>
        <StepNumber>3</StepNumber>
        <StepBody>
          <StepTitle>Make a small trade first</StepTitle>
          <StepText>
            Before a larger position, execute a test with a low amount to
            validate wallet, liquidity, timing, approvals and flow UX.
          </StepText>
        </StepBody>
      </Step>
      <Step>
        <StepNumber>4</StepNumber>
        <StepBody>
          <StepTitle>Set operational limits</StepTitle>
          <StepText>
            Establish max slippage, size per trade, allowed assets and
            minimum liquidity criteria.
          </StepText>
        </StepBody>
      </Step>
    </Steps>

    <H2>Network endpoints</H2>
    <Table>
      <thead>
        <tr>
          <th>Environment</th>
          <th>WebSocket RPC</th>
          <th>Recommended use</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Testnet</td>
          <td>
            <InlineCode>wss://ws-test.lunes.io</InlineCode>
          </td>
          <td>Initial validation, integration QA, experimental flow</td>
        </tr>
        <tr>
          <td>Mainnet</td>
          <td>
            <InlineCode>wss://ws.lunes.io</InlineCode>
          </td>
          <td>Primary operations</td>
        </tr>
        <tr>
          <td>Mainnet Backup</td>
          <td>
            <InlineCode>wss://ws-lunes-main-01.lunes.io</InlineCode>
          </td>
          <td>Connectivity fallback</td>
        </tr>
        <tr>
          <td>Archive</td>
          <td>
            <InlineCode>wss://ws-archive.lunes.io</InlineCode>
          </td>
          <td>Historical queries and analytics</td>
        </tr>
      </tbody>
    </Table>

    <H2>Recommended flow for the first trade</H2>
    <Checklist>
      <li>Connect the wallet and confirm the address shown in the UI.</li>
      <li>
        Open <InlineCode>/swap</InlineCode> and test a quote between liquid
        assets.
      </li>
      <li>
        Check price impact, minimum received and token approval.
      </li>
      <li>
        Execute a small order and verify the result before increasing the
        size.
      </li>
      <li>
        Only then move on to spot, margin or copytrade strategies.
      </li>
    </Checklist>

    <Callout variant="warning">
      <strong>Don't skip steps.</strong> Most DeFi operational incidents come
      from wrong network, excessive approval, incorrect token or execution with
      size above the pair's liquidity.
    </Callout>
  </>
)

const TradingSection = () => (
  <>
    <H2>Choosing the right product</H2>
    <Table>
      <thead>
        <tr>
          <th>Product</th>
          <th>When it makes sense</th>
          <th>Watch out for</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Swap</td>
          <td>Quick conversion between assets</td>
          <td>Watch slippage, price impact and token approval</td>
        </tr>
        <tr>
          <td>Spot</td>
          <td>Execution with clearer market reading</td>
          <td>Monitor liquidity, order book and entry/exit discipline</td>
        </tr>
        <tr>
          <td>Margin</td>
          <td>Leveraged exposure with active management</td>
          <td>
            Higher risk; requires size control, collateral and health factor management
          </td>
        </tr>
      </tbody>
    </Table>

    <H2>Professional execution flow</H2>
    <Checklist>
      <li>
        Define the trade objective: scalp, swing, hedge or rebalance.
      </li>
      <li>
        Choose the product that matches the objective and available liquidity.
      </li>
      <li>
        Read the pair: spread, depth, volatility and market context.
      </li>
      <li>
        Set the max size per trade and invalidation point before executing.
      </li>
      <li>
        After execution, log price, slippage and result to feed back into your
        discipline.
      </li>
    </Checklist>

    <H2>Best practices for Spot and Margin</H2>
    <Grid>
      <Card span={6}>
        <CardTitle>Spot</CardTitle>
        <CardText>
          Prefer more liquid pairs when testing new strategies. In times of low
          depth, medium orders can distort the entry and exit price.
        </CardText>
      </Card>
      <Card span={6}>
        <CardTitle>Margin</CardTitle>
        <CardText>
          Use leverage as a conviction amplifier, not as a substitute for risk
          management. Start with smaller sizes and maintain operational margin.
        </CardText>
      </Card>
    </Grid>

    <Callout variant="warning">
      <strong>For margin:</strong> never trade at the limit of available
      collateral. Maintain a safety buffer for volatility, implied funding,
      mark price updates and potential sharp pair moves.
    </Callout>

    <H2>Frontend integration example</H2>
    <P>
      If you are building an experience within the app itself, the preferred
      path is to start with <InlineCode>useSDK()</InlineCode>.
    </P>
    <Code>{`import { useSDK } from '../../context/SDKContext'

const TradingWidget = () => {
  const {
    connectWallet,
    walletAddress,
    getQuote,
    executeSwap,
    calculateDeadline,
    calculateMinAmount,
  } = useSDK()

  const handleSwap = async () => {
    if (!walletAddress) {
      await connectWallet()
      return
    }

    const amountIn = '1000000000000'
    const path = [TOKEN_IN, TOKEN_OUT]
    const quote = await getQuote(amountIn, path)

    if (!quote) return

    await executeSwap({
      amountIn,
      amountOutMin: calculateMinAmount(quote.amountOut, 1),
      path,
      to: walletAddress,
      deadline: calculateDeadline(10),
    })
  }

  return <button onClick={handleSwap}>Execute swap</button>
}`}</Code>
  </>
)

const CopytradeSection = () => (
  <>
    <H2>How copytrade works</H2>
    <P>
      On Lunex, copytrade and social trading are driven by{' '}
      <strong>vaults</strong>. Instead of replicating each order separately for
      every follower, the system concentrates execution and distributes the
      result proportionally. This improves consistency, reduces friction and
      creates a more professional experience for those following leaders.
    </P>

    <H2>What to evaluate before following a leader</H2>
    <Table>
      <thead>
        <tr>
          <th>Metric</th>
          <th>What to observe</th>
          <th>Practical interpretation</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>ROI 30d / 90d</td>
          <td>Consistency across time windows</td>
          <td>High isolated return without consistency may just be luck</td>
        </tr>
        <tr>
          <td>Drawdown</td>
          <td>How much the strategy gives back in bad phases</td>
          <td>High drawdown requires more psychological and capital tolerance</td>
        </tr>
        <tr>
          <td>AUM</td>
          <td>How much capital the strategy has attracted</td>
          <td>Helps measure market confidence, but doesn't replace analysis</td>
        </tr>
        <tr>
          <td>Fee</td>
          <td>Performance fee charged</td>
          <td>Compare fee with consistency and leader transparency</td>
        </tr>
      </tbody>
    </Table>

    <H2>Due diligence checklist</H2>
    <Checklist>
      <li>
        Read the leader's bio, history and positioning before depositing.
      </li>
      <li>Check if the results are compatible with the risk taken.</li>
      <li>
        Avoid allocating significant capital in strategies you don't understand.
      </li>
      <li>
        Start small and observe execution for more than one market cycle.
      </li>
      <li>
        Diversify across strategies instead of concentrating everything in a
        single profile.
      </li>
    </Checklist>

    <Callout variant="success">
      <strong>Vault model:</strong> better operational alignment, more consistent
      execution across followers and proportional result distribution. That said,
      market risk still exists.
    </Callout>

    <H2>Where to track in the product</H2>
    <Table>
      <thead>
        <tr>
          <th>Route</th>
          <th>Use</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <InlineCode>/social</InlineCode>
          </td>
          <td>Explore leaderboard, ideas and general statistics</td>
        </tr>
        <tr>
          <td>
            <InlineCode>/social/profile/:id</InlineCode>
          </td>
          <td>Analyze leader profile, history and context</td>
        </tr>
        <tr>
          <td>
            <InlineCode>/spot/copytrade</InlineCode>
          </td>
          <td>Copytrade experience flows</td>
        </tr>
      </tbody>
    </Table>
  </>
)



const LiquiditySection = () => (
  <>
    <H2>When providing liquidity makes sense</H2>
    <P>
      Providing liquidity is a different activity from directional trading.
      You trade part of the pure upside potential for fee generation and
      participation in incentive programs. It works best when you understand
      the pair's behavior and the risk of{' '}
      <strong>impermanent loss</strong>.
    </P>

    <H2>Practical decision for LPs</H2>
    <Table>
      <thead>
        <tr>
          <th>Context</th>
          <th>May make sense</th>
          <th>Requires caution</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Stable / correlated pairs</td>
          <td>Greater inventory predictability</td>
          <td>Lower yield may not compensate if volume is low</td>
        </tr>
        <tr>
          <td>Volatile pairs</td>
          <td>Higher fees during high volume phases</td>
          <td>Impermanent loss can also increase significantly</td>
        </tr>
        <tr>
          <td>Active reward programs</td>
          <td>Improves total return</td>
          <td>Don't use temporary incentives as the sole criterion</td>
        </tr>
      </tbody>
    </Table>

    <H2>Recommended flow</H2>
    <Checklist>
      <li>Validate the pair, depth and historical volume.</li>
      <li>
        Understand which asset you want to accumulate if the price moves against
        your thesis.
      </li>
      <li>Simulate impermanent loss scenarios before depositing.</li>
      <li>Track rewards and reassess the position when the incentive changes.</li>
    </Checklist>

    <H2>Integration example for builders</H2>
    <Code>{`const { addLiquidity, removeLiquidity, getPairInfo, calculateDeadline, walletAddress } = useSDK()

const pair = await getPairInfo(TOKEN_A, TOKEN_B)

if (pair && walletAddress) {
  await addLiquidity({
    tokenA: TOKEN_A,
    tokenB: TOKEN_B,
    amountADesired: amountA,
    amountBDesired: amountB,
    amountAMin: minA,
    amountBMin: minB,
    to: walletAddress,
    deadline: calculateDeadline(10),
  })
}`}</Code>

    <Callout variant="warning">
      <strong>Important:</strong> high rewards do not eliminate structural risk.
      Always analyze pair quality and the opportunity cost of allocated capital.
    </Callout>
  </>
)

const DevelopersSection = () => (
  <>
    <H2>Integration surfaces</H2>
    <Table>
      <thead>
        <tr>
          <th>Layer</th>
          <th>File</th>
          <th>Recommended use</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <InlineCode>SDKContext</InlineCode>
          </td>
          <td>
            <InlineCode>src/context/SDKContext.tsx</InlineCode>
          </td>
          <td>
            Best starting point for React experiences integrated with the app
          </td>
        </tr>
        <tr>
          <td>
            <InlineCode>contractService</InlineCode>
          </td>
          <td>
            <InlineCode>src/services/contractService.ts</InlineCode>
          </td>
          <td>Lower-level control of contracts, RPC and transactions</td>
        </tr>
        <tr>
          <td>
            <InlineCode>socialService</InlineCode>
          </td>
          <td>
            <InlineCode>src/services/socialService.ts</InlineCode>
          </td>
          <td>Consume leaderboard, ideas, profiles and copytrade via backend</td>
        </tr>
        <tr>
          <td>
            <InlineCode>marginService</InlineCode>
          </td>
          <td>
            <InlineCode>src/services/marginService.ts</InlineCode>
          </td>
          <td>Consume overview, positions and margin operational health</td>
        </tr>
        <tr>
          <td>
            <InlineCode>SDK package</InlineCode>
          </td>
          <td>
            <InlineCode>sdk/src</InlineCode>
          </td>
          <td>External TypeScript integration for applications and automations</td>
        </tr>
        <tr>
          <td>
            <InlineCode>MCP</InlineCode>
          </td>
          <td>
            <InlineCode>mcp/lunex-agent-mcp</InlineCode>
          </td>
          <td>OpenClaw agents and automations with structured tools</td>
        </tr>
      </tbody>
    </Table>

    <H2>Integration best practices</H2>
    <Checklist>
      <li>
        Use the highest-level layer first; go lower only when you
        need to.
      </li>
      <li>
        Separate authentication, market reading and order execution into
        independent modules.
      </li>
      <li>
        Treat timeouts, RPC drops and partial responses as normal
        scenarios.
      </li>
      <li>
        For bots, maintain size limits, cooldowns and asset
        whitelists.
      </li>
    </Checklist>

    <H2>Health and observability</H2>
    <P>
      The spot backend exposes useful operational surfaces for integration
      and monitoring.
    </P>
    <Code>{`GET  /health
GET  /metrics
GET  /api/v1/margin/price-health
POST /api/v1/margin/price-health/reset`}</Code>

    <H3>Example with SDK</H3>
    <Code>{`import LunexSDK from '@lunex/sdk'

const sdk = new LunexSDK({
  baseURL: 'http://localhost:4000',
  wsURL: 'ws://localhost:4000',
})

const health = await sdk.market.getHealth()
const marginHealth = await sdk.market.getMarginPriceHealth()
const metrics = await sdk.market.getMetrics()

console.log({ health, marginHealth, metrics })`}</Code>

    <H3>React example with margin service</H3>
    <Code>{`import { marginApi } from '../services/marginService'

const health = await marginApi.getPriceHealth()
const pairState = await marginApi.getPriceHealth('LUNES/USDT')
await marginApi.resetPriceHealth('LUNES/USDT')`}</Code>

    <Callout>
      <strong>Builder tip:</strong> if you are building assisted operations or
      internal dashboards, combine <InlineCode>/health</InlineCode>,{' '}
      <InlineCode>/metrics</InlineCode> and the{' '}
      <InlineCode>margin price health</InlineCode> contract for alerts and preventive UX.
    </Callout>
  </>
)

const SecuritySection = () => (
  <>
    <H2>Operational security principles</H2>
    <Checklist>
      <li>
        Never expose seed phrases, secret seeds or private keys in browser
        logs, source code or screenshots.
      </li>
      <li>
        Review token permissions periodically, especially after tests or
        new integrations.
      </li>
      <li>
        Use reduced size on new pairs, new contracts and new
        strategies.
      </li>
      <li>
        Validate token, contract and route before signing any transaction.
      </li>
      <li>
        In automations, isolate credentials, enforce limits and log all
        critical actions.
      </li>
    </Checklist>

    <H2>Most common risks</H2>
    <Table>
      <thead>
        <tr>
          <th>Risk</th>
          <th>How it appears</th>
          <th>Mitigation</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Excessive approval</td>
          <td>User approves more than needed for a contract</td>
          <td>Approve only what's necessary and review allowances</td>
        </tr>
        <tr>
          <td>Bad slippage</td>
          <td>Execution much worse than the quote</td>
          <td>Set minimum received and avoid shallow books/pools</td>
        </tr>
        <tr>
          <td>Wrong token</td>
          <td>Similar contract or unverified asset</td>
          <td>Confirm address and context before trading</td>
        </tr>
        <tr>
          <td>Overleverage</td>
          <td>Position very sensitive to small price changes</td>
          <td>Start smaller, preserve collateral and monitor health</td>
        </tr>
        <tr>
          <td>Automation without limits</td>
          <td>Bot executes above expectations</td>
          <td>Use max notional, cooldown and circuit breakers</td>
        </tr>
      </tbody>
    </Table>

    <Callout variant="warning">
      <strong>If something seems off, stop.</strong> Quote divergence,
      inconsistent interface, unrecognized token or unexpected behavior are
      signals to halt execution and validate before proceeding.
    </Callout>
  </>
)

const FAQSection = () => (
  <>
    <H2>Frequently asked questions</H2>

    <H3>What is the best entry point for new users?</H3>
    <P>
      Start with <InlineCode>/swap</InlineCode> using a small amount. Then
      move on to Spot, Liquidity or Copytrade based on your profile.
    </P>

    <H3>How do I know if a copytrade leader is reliable?</H3>
    <P>
      Look at consistency, drawdown, fee charged, profile transparency and
      compatibility of the strategy with your own risk appetite.
    </P>

    <H3>When should I use margin?</H3>
    <P>
      Only when you already have operational discipline and understand position
      sizing, volatility, collateral and the impact of leverage in adverse
      scenarios.
    </P>

    <H3>What technical resources are available for integration?</H3>
    <P>
      You can use the frontend context, app services, the TypeScript SDK, the
      Spot API and the MCP for agents and automations.
    </P>

    <H3>Where can I find support?</H3>
    <P>
      Use the official Lunex/Lunes institutional links, community channels
      and the repository's technical documentation when you need to dive deeper
      into integrations.
    </P>

    <H2>Quick troubleshooting</H2>
    <Checklist>
      <li>
        If the wallet won't connect, check the extension, active account and
        browser permissions.
      </li>
      <li>
        If the quote looks bad, check pair liquidity and trade size.
      </li>
      <li>
        If a transaction fails, review approval, balance, network and execution
        deadline.
      </li>
      <li>
        If an integration fails, validate <InlineCode>baseURL</InlineCode>, RPC,
        contracts and credentials before debugging business logic.
      </li>
    </Checklist>
  </>
)

const SECTIONS: Record<Section, React.FC> = {
  overview: OverviewSection,
  'getting-started': GettingStartedSection,
  trading: TradingSection,
  copytrade: CopytradeSection,
  liquidity: LiquiditySection,
  developers: DevelopersSection,
  security: SecuritySection,
  faq: FAQSection
}

const Docs: React.FC = () => {
  const navigate = useNavigate()
  const [activeSection, setActiveSection] = useState<Section>('overview')
  const [search, setSearch] = useState('')
  const ActiveContent = SECTIONS[activeSection]

  const filteredNavItems = useMemo(() => {
    const query = search.trim().toLowerCase()

    if (!query) return NAV_ITEMS

    return NAV_ITEMS.filter(item => {
      return [item.label, item.description, item.audience].some(value =>
        value.toLowerCase().includes(query)
      )
    })
  }, [search])

  useEffect(() => {
    const hash = window.location.hash.replace('#', '') as Section
    if (hash && hash in SECTIONS) {
      setActiveSection(hash)
    }
  }, [])

  useEffect(() => {
    window.history.replaceState(null, '', `#${activeSection}`)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [activeSection])

  const switchSection = (section: Section) => {
    setActiveSection(section)
  }

  return (
    <Page>
      <Sidebar>
        <SidebarTitle>Documentation</SidebarTitle>
        <SidebarIntro>
          Central guide from Lunex for users, traders, LPs and builders. Choose
          a track or search for what you need.
        </SidebarIntro>
        <SearchBox>
          <SearchIcon />
          <SearchInput
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search by topic, profile or resource"
          />
        </SearchBox>
        {filteredNavItems.length > 0 ? (
          filteredNavItems.map(item => (
            <SidebarItem
              key={item.id}
              active={item.id === activeSection}
              onClick={() => switchSection(item.id)}
            >
              <SidebarItemHeader>
                {item.icon}
                {item.label}
                <AudienceBadge>{item.audience}</AudienceBadge>
              </SidebarItemHeader>
              <SidebarItemDescription>
                {item.description}
              </SidebarItemDescription>
            </SidebarItem>
          ))
        ) : (
          <EmptyState>
            No topics found for this search. Try terms like{' '}
            <InlineCode>trading</InlineCode>, <InlineCode>copytrade</InlineCode>{' '}
            or <InlineCode>SDK</InlineCode>.
          </EmptyState>
        )}
      </Sidebar>

      <Main>
        <Hero>
          <Kicker>
            <BookIcon />
            Lunex Knowledge Base
          </Kicker>
          <H1>
            <span>Documentation</span> focused on real usage
          </H1>
          <Lead>
            This area has been reorganized to better serve those who use the
            platform day to day. Instead of just listing features, it helps you
            choose the right product, operate more safely and integrate Lunex
            more professionally.
          </Lead>
          <CTAGroup>
            <CTAButton onClick={() => navigate('/swap')}>
              <ArrowIcon />
              Start with Swap
            </CTAButton>
            <CTAButton secondary onClick={() => navigate('/spot')}>
              <ArrowIcon />
              Open Spot
            </CTAButton>
            <CTAButton secondary onClick={() => navigate('/social')}>
              <ArrowIcon />
              Explore Social
            </CTAButton>
          </CTAGroup>
          <StatsRow>
            <StatCard>
              <StatValue>3</StatValue>
              <StatLabel>
                Main tracks for users: trading, liquidity and copytrade
              </StatLabel>
            </StatCard>
            <StatCard>
              <StatValue>4</StatValue>
              <StatLabel>
                Immediate integration surfaces for builders and automations
              </StatLabel>
            </StatCard>
            <StatCard>
              <StatValue>8</StatValue>
              <StatLabel>
                Topics organized by use objective, not just by technology
              </StatLabel>
            </StatCard>
            <StatCard>
              <StatValue>Step 1</StatValue>
              <StatLabel>
                Always validate wallet, network and small trade before scaling
              </StatLabel>
            </StatCard>
          </StatsRow>
        </Hero>

        <Grid>
          <Card>
            <CardTitle>New users</CardTitle>
            <CardText>
              Go to <InlineCode>Getting Started</InlineCode> and then{' '}
              <InlineCode>Trading</InlineCode> to set up your initial routine
              with less friction.
            </CardText>
          </Card>
          <Card>
            <CardTitle>Investors</CardTitle>
            <CardText>
              Use <InlineCode>Social & Copytrade</InlineCode> to understand
              leaders, vaults and minimum due diligence before allocating.
            </CardText>
          </Card>
          <Card>
            <CardTitle>Builders</CardTitle>
            <CardText>
              Open <InlineCode>Developers</InlineCode> to map SDK,
              services, health checks and operational observability.
            </CardText>
          </Card>
        </Grid>

        <H2>{SECTION_INTRO[activeSection].title}</H2>
        <P>{SECTION_INTRO[activeSection].description}</P>
        <SectionDivider />
        <ActiveContent />
      </Main>

      <RightRail>
        <RailCard>
          <RailTitle>Quick shortcuts</RailTitle>
          <RailList>
            <RailLink onClick={() => navigate('/swap')}>
              <RailLinkLabel>Swap</RailLinkLabel>
              <RailLinkDescription>
                Simple flow for your first trade and quick conversions.
              </RailLinkDescription>
            </RailLink>
            <RailLink onClick={() => navigate('/spot')}>
              <RailLinkLabel>Spot</RailLinkLabel>
              <RailLinkDescription>
                Trading view for more active execution.
              </RailLinkDescription>
            </RailLink>
            <RailLink onClick={() => navigate('/spot/copytrade')}>
              <RailLinkLabel>Copytrade</RailLinkLabel>
              <RailLinkDescription>
                Join strategies via leaders and vaults.
              </RailLinkDescription>
            </RailLink>
          </RailList>
        </RailCard>

        <RailCard>
          <RailTitle>Recommended reading</RailTitle>
          <RailText>
            If you want to trade better, read in order:{' '}
            <InlineCode>Getting Started</InlineCode>, <InlineCode>Trading</InlineCode>{' '}
            and <InlineCode>Security</InlineCode>.
          </RailText>
        </RailCard>

        <RailCard>
          <RailTitle>For builders</RailTitle>
          <RailText>
            Start with <InlineCode>SDKContext</InlineCode> in the app. For
            external integrations, use the{' '}
            <InlineCode>@lunex/sdk</InlineCode> package and MCP when you need
            agentic workflows.
          </RailText>
        </RailCard>
      </RightRail>
    </Page>
  )
}

export default Docs
