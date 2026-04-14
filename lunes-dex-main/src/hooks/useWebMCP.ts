import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * WebMCP Initializer — registers tools, prompts, and resources
 * so AI agents (Gemini, Claude, browser extensions) can interact
 * with the Lunex DEX programmatically.
 *
 * Reference: https://webmcp.dev/
 * Chrome EPP: https://developer.chrome.com/blog/webmcp-epp
 */

declare global {
  interface Window {
    WebMCP: any
  }
}

const WEBMCP_CDN =
  'https://unpkg.com/@anthropic-ai/webmcp@latest/dist/webmcp.min.js'

// Available routes in the app
const APP_ROUTES: Record<string, string> = {
  swap: '/swap',
  spot: '/spot',
  pools: '/pools',
  staking: '/staking',
  rewards: '/rewards',
  copytrade: '/spot/copytrade',
  agents: '/agent',
  strategies: '/strategies',
  governance: '/governance',
  docs: '/docs',
  affiliates: '/affiliates'
}

export function useWebMCP() {
  const navigate = useNavigate()

  useEffect(() => {
    // Try native window.ai first, fallback to CDN library
    const init = () => {
      if (!window.WebMCP) return

      const mcp = new window.WebMCP({
        color: '#00E5A0',
        position: 'bottom-right',
        size: '36px',
        padding: '12px'
      })

      // ─── TOOLS ───────────────────────────────────────────────

      // 1. Navigate to any page
      mcp.registerTool(
        'navigate_to_page',
        'Navigate to a specific page of the Lunex DEX. Available pages: swap, spot, pools, staking, rewards, copytrade, agents, strategies, governance, docs, affiliates.',
        {
          page: {
            type: 'string',
            description:
              'Page name: swap, spot, pools, staking, rewards, copytrade, agents, strategies, governance, docs, affiliates'
          }
        },
        (args: { page: string }) => {
          const path = APP_ROUTES[args.page?.toLowerCase()]
          if (!path) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Unknown page "${args.page}". Available: ${Object.keys(APP_ROUTES).join(', ')}`
                }
              ]
            }
          }
          navigate(path)
          return {
            content: [
              {
                type: 'text',
                text: `Navigated to ${args.page} (${path})`
              }
            ]
          }
        }
      )

      // 2. Get protocol info
      mcp.registerTool(
        'get_protocol_info',
        'Get information about the Lunex DEX protocol, its features, and trading modes.',
        {},
        () => ({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                name: 'Lunex DEX',
                description: 'Unified trading protocol on Lunes blockchain',
                blockchain: 'Lunes (Substrate-based)',
                features: [
                  'AMM Swap — instant token conversion',
                  'Spot Orderbook — limit and market orders',
                  'AI Agents — autonomous trading bots via OpenClaw',
                  'Copy Trading — follow top traders',
                  'Asymmetric Liquidity — concentrated LP positions',
                  'Strategy Marketplace — deploy or publish strategies',
                  'Staking — LUNES lockups for yield',
                  'Rewards — tiered reward distribution',
                  'Governance — on-chain voting'
                ],
                nativeToken: 'LUNES',
                stablecoin: 'lUSDT (PSP22)',
                tradingFee: '0.25 bps (maker) / 0.50 bps (taker)',
                executionSpeed: '<3 seconds',
                custody: 'Non-custodial (self-custody)',
                docs: 'https://docs.lunes.io',
                github: 'https://github.com/lunes-platform'
              })
            }
          ]
        })
      )

      // 3. Get wallet connection status
      mcp.registerTool(
        'get_wallet_status',
        'Check whether the user has connected their Lunes wallet.',
        {},
        () => {
          const raw = localStorage.getItem('lunex-wallet')
          const parsed = raw ? JSON.parse(raw) : null
          const address = parsed?.address
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  connected: !!address,
                  address: address || null
                })
              }
            ]
          }
        }
      )

      // 4. Get available trading pairs
      mcp.registerTool(
        'get_trading_pairs',
        'Get the list of available trading pairs on the Lunex DEX spot orderbook.',
        {},
        () => ({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                pairs: [
                  { symbol: 'LUNES/lUSDT', base: 'LUNES', quote: 'lUSDT' },
                  { symbol: 'BTC/lUSDT', base: 'BTC', quote: 'lUSDT' },
                  { symbol: 'ETH/lUSDT', base: 'ETH', quote: 'lUSDT' }
                ],
                note: 'Navigate to /spot for live orderbook data'
              })
            }
          ]
        })
      )

      // ─── RESOURCES ───────────────────────────────────────────

      // Expose page content for context
      mcp.registerResource(
        'page-content',
        'Current page content of the Lunex DEX',
        { uri: 'lunex://page/current', mimeType: 'text/html' },
        () => ({
          contents: [
            {
              uri: 'lunex://page/current',
              mimeType: 'text/html',
              text: document.body.innerText.substring(0, 4000)
            }
          ]
        })
      )

      // Expose site structure
      mcp.registerResource(
        'site-map',
        'Complete site structure of the Lunex DEX with all available routes',
        { uri: 'lunex://sitemap', mimeType: 'application/json' },
        () => ({
          contents: [
            {
              uri: 'lunex://sitemap',
              mimeType: 'application/json',
              text: JSON.stringify({
                routes: Object.entries(APP_ROUTES).map(([name, path]) => ({
                  name,
                  path
                })),
                externalLinks: [
                  { name: 'Documentation', url: 'https://docs.lunes.io' },
                  { name: 'GitHub', url: 'https://github.com/lunes-platform' }
                ]
              })
            }
          ]
        })
      )

      // ─── PROMPTS ─────────────────────────────────────────────

      mcp.registerPrompt(
        'help-trading',
        'Help the user get started with trading on Lunex',
        [],
        () => ({
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: 'I want to start trading on the Lunex DEX. What trading modes are available and how do I get started? Please guide me step by step.'
              }
            }
          ]
        })
      )

      mcp.registerPrompt(
        'compare-strategies',
        'Compare trading strategies available on the Lunex marketplace',
        [],
        () => ({
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: 'Compare the trading strategies available on the Lunex Strategy Marketplace. Which ones are best for a conservative investor vs an aggressive trader?'
              }
            }
          ]
        })
      )
    }

    // Load WebMCP library via CDN
    if (window.WebMCP) {
      init()
    } else {
      const script = document.createElement('script')
      script.src = WEBMCP_CDN
      script.async = true
      script.onload = init
      document.head.appendChild(script)
    }
  }, [navigate])
}
