import React, { useState, useMemo } from 'react'
import styled from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { Zap, LayoutGrid, Triangle, Bot } from 'lucide-react'
import PageLayout from '../../../components/layout'
import TradeSubNav from '../../../components/tradeSubNav'
import CurveChart, { CurveParams, simulateLiquidity } from '../../../components/asymmetric/CurveChart'
import StrategyCards, { STRATEGY_TEMPLATES, StrategyTemplate } from '../../../components/asymmetric/StrategyCards'
import AgentDelegationPanel from '../../../components/asymmetric/AgentDelegationPanel'
import { useSDK } from '../../../context/SDKContext'
import { useAsymmetricDeploy } from '../../../hooks/useAsymmetricDeploy'
import { Button } from '../../../components/bases'

// ─── Tabs ─────────────────────────────────────────────────────────

type Tab = 'strategies' | 'builder' | 'delegate'

// ─── Styled ───────────────────────────────────────────────────────

const TabBar = styled.div`
  display: flex;
  gap: 4px;
  background: ${({ theme }) => theme.colors.themeColors[600]};
  border-radius: 12px;
  padding: 4px;
`

const TabButton = styled.button<{ active: boolean }>`
  flex: 1;
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: 13px;
  transition: all 0.18s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: ${({ active, theme }) =>
    active ? theme.colors.themeColors[800] : 'transparent'};
  color: ${({ active, theme }) =>
    active ? theme.colors.themeColors[100] : theme.colors.themeColors[200]};
  &:hover {
    background: ${({ active, theme }) =>
    active ? theme.colors.themeColors[800] : theme.colors.themeColors[400]};
  }
`

const PageHeader = styled.div`
  padding: 24px 0 12px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
`

const PageTitle = styled.h1`
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 800;
  font-size: 22px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  margin: 0 0 4px;
  display: flex;
  align-items: center;
  gap: 8px;
`

const PageSubtitle = styled.p`
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
  margin: 0;
  text-align: left;
`

const SectionTitle = styled.h3`
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  margin: 0 0 12px;
`

const SelectedCard = styled.div`
  padding: 14px 18px;
  border-radius: 12px;
  background: ${({ theme }) => theme.colors.themeColors[500]};
  border: 1px solid ${({ theme }) => theme.colors.themeColors[400]};
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
  display: flex;
  align-items: center;
  gap: 10px;
`

const SliderGroup = styled.div`
  background: ${({ theme }) => theme.colors.themeColors[600]};
  border-radius: 16px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const SliderRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const SliderLabel = styled.span`
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  min-width: 170px;
`

const Slider = styled.input`
  flex: 1;
  -webkit-appearance: none;
  height: 4px;
  border-radius: 2px;
  background: ${({ theme }) => theme.colors.themeColors[400]};
  outline: none;
  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: ${({ theme }) => theme.colors.primary[500]};
    cursor: pointer;
    box-shadow: 0 0 0 3px rgba(108, 56, 255, 0.25);
  }
`

const SliderValue = styled.span`
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  min-width: 28px;
  text-align: right;
`

const SliderHint = styled.span`
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
`

const SubSectionTitle = styled.h4`
  font-family: 'Space Grotesk', sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.themeColors[200]};
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0;
`



// ─── Deploy Modal Styled ──────────────────────────────────────────

const DeployOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
`

const DeployModal = styled.div`
  background: ${({ theme }) => theme.colors.themeColors[500]};
  border-radius: 16px;
  padding: 28px;
  width: 100%;
  max-width: 480px;
  border: 1px solid ${({ theme }) => theme.colors.themeColors[400]};
  display: flex;
  flex-direction: column;
  gap: 16px;
  position: relative;
`

const DeployModalTitle = styled.h2`
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 18px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  margin: 0;
`

const DeployModalNote = styled.p`
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
  line-height: 1.6;
  margin: 0;
`


const StatusBox = styled.div<{ variant: 'success' | 'error' | 'loading' }>`
  padding: 12px 16px;
  border-radius: 10px;
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  background: ${({ variant }) =>
    variant === 'success' ? 'rgba(52,211,153,0.1)'
      : variant === 'error' ? 'rgba(248,113,113,0.1)'
        : 'rgba(255,255,255,0.05)'};
  border: 1px solid ${({ variant }) =>
    variant === 'success' ? 'rgba(52,211,153,0.3)'
      : variant === 'error' ? 'rgba(248,113,113,0.3)'
        : 'rgba(255,255,255,0.1)'};
  color: ${({ variant }) =>
    variant === 'success' ? '#34d399'
      : variant === 'error' ? '#f87171'
        : '#9ca3af'};
`

const TxHashLink = styled.code`
  display: block;
  font-size: 11px;
  word-break: break-all;
  margin-top: 6px;
  opacity: 0.7;
`

const RowButtons = styled.div`
  display: flex;
  gap: 10px;
`



const DelegateCard = styled.div`
  background: ${({ theme }) => theme.colors.themeColors[600]};
  border-radius: 16px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: flex-start;
`

const DelegateTitle = styled.h3`
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 16px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
  margin: 0;
`

const DelegateDescription = styled.p`
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
  line-height: 1.7;
  margin: 0;
`

const FeatureList = styled.ul`
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const FeatureItem = styled.li`
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
  display: flex;
  align-items: center;
  gap: 8px;
  &::before { content: '✓'; color: #34d399; font-weight: 700; }
`

// ─── Simulation Panel for Live Preview ─────────────────────────────

const LivePreview = styled.div`
  background: ${({ theme }) => theme.colors.themeColors[500]};
  border-radius: 12px;
  padding: 14px 18px;
`

const PreviewGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 16px;
`

const PreviewItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const PreviewKey = styled.span`
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  color: ${({ theme }) => theme.colors.themeColors[200]};
`

const PreviewVal = styled.span<{ color?: string }>`
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 14px;
  color: ${({ color, theme }) => color || theme.colors.themeColors[100]};
`

// ─── Component ────────────────────────────────────────────────────

const GAMMA_LABELS = ['', 'Linear', 'Moderate', 'Balanced', 'Aggressive', 'Extreme']

const defaultBuy: CurveParams = { k: 1000, L: 0, c: 0.5, x0: 10000, gamma: 3, feeT: 0.003, interestR: 0 }
const defaultSell: CurveParams = { k: 500, L: 0, c: 0.5, x0: 8000, gamma: 2, feeT: 0.003, interestR: 0 }

const AsymmetricPool: React.FC = () => {
  const { isConnected, connectWallet } = useSDK()
  const navigate = useNavigate()
  const { state: deployState, deploy, reset: resetDeploy } = useAsymmetricDeploy()

  const [activeTab, setActiveTab] = useState<Tab>('strategies')
  const [selectedTemplate, setSelectedTemplate] = useState<StrategyTemplate | null>(null)
  const [showDelegate, setShowDelegate] = useState(false)
  const [showDeployModal, setShowDeployModal] = useState(false)

  // Builder state
  const [buyParams, setBuyParams] = useState<CurveParams>(defaultBuy)
  const [sellParams, setSellParams] = useState<CurveParams>(defaultSell)

  // Live preview of liquidity at the mid-point
  const midLiqPreview = useMemo(() => {
    const midBuy = simulateLiquidity(buyParams.x0 * 0.3, buyParams)
    const midSell = simulateLiquidity(sellParams.x0 * 0.3, sellParams)
    return { midBuy, midSell }
  }, [buyParams, sellParams])

  const handleSelectTemplate = (t: StrategyTemplate) => {
    setSelectedTemplate(t)
    setBuyParams({ ...defaultBuy, gamma: t.buyParams.gamma, x0: t.buyParams.x0, feeT: t.buyParams.feeT })
    setSellParams({ ...defaultSell, gamma: t.sellParams.gamma, x0: t.sellParams.x0, feeT: t.sellParams.feeT })
    setActiveTab('builder')
  }

  const handleDeploy = async () => {
    await deploy({
      baseToken: process.env.REACT_APP_TOKEN_WLUNES || '',
      quoteToken: process.env.REACT_APP_TOKEN_LUSDT || '',
      buyGamma: buyParams.gamma,
      buyMaxCapacity: buyParams.x0.toString(),
      buyFeeBps: Math.round(buyParams.feeT * 10000),
      sellGamma: sellParams.gamma,
      sellMaxCapacity: sellParams.x0.toString(),
      sellFeeBps: Math.round(sellParams.feeT * 10000),
      initialBuyK: (buyParams.k).toString(),
      initialSellK: (sellParams.k * 0.5).toString(),
      pairSymbol: 'WLUNES-LUSDT',
      autoRebalance: true,
      profitTargetBps: selectedTemplate?.profitTargetBps ?? 300,
    })
  }

  return (
    <PageLayout maxWidth="680px">
      <TradeSubNav active="pool" />

      <PageHeader>
        <PageTitle>
          <Zap size={24} strokeWidth={2} style={{ color: 'currentColor' }} />
          Asymmetric Liquidity
        </PageTitle>
        <PageSubtitle>Parametric curves for advanced liquidity providers — human or AI-managed.</PageSubtitle>
      </PageHeader>

      <TabBar>
        <TabButton active={activeTab === 'strategies'} onClick={() => setActiveTab('strategies')}>
          <LayoutGrid size={16} strokeWidth={2} style={{ color: 'currentColor' }} />
          Templates
        </TabButton>
        <TabButton active={activeTab === 'builder'} onClick={() => setActiveTab('builder')}>
          <Triangle size={16} strokeWidth={2} style={{ color: 'currentColor' }} />
          Builder Pro
        </TabButton>
        <TabButton active={activeTab === 'delegate'} onClick={() => setActiveTab('delegate')}>
          <Bot size={16} strokeWidth={2} style={{ color: 'currentColor' }} />
          Delegate AI
        </TabButton>
      </TabBar>

      {/* ── Strategies Tab ─────────────────────────────────────────── */}
      {activeTab === 'strategies' && (
        <>
          <SectionTitle>Pick a Strategy — One Click to Configure</SectionTitle>
          <StrategyCards selected={selectedTemplate?.id ?? null} onSelect={handleSelectTemplate} />

          {selectedTemplate && (
            <SelectedCard>
              <span>{selectedTemplate.icon}</span>
              <span>
                <strong>{selectedTemplate.name}</strong> selected — edit it in the Builder Pro tab
              </span>
            </SelectedCard>
          )}
        </>
      )}

      {/* ── Builder Pro Tab ────────────────────────────────────────── */}
      {activeTab === 'builder' && (
        <>
          <CurveChart
            buyParams={buyParams}
            sellParams={sellParams}
            label={selectedTemplate ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {selectedTemplate.icon} {selectedTemplate.name}
              </div>
            ) : 'Custom Curve'}
            interactive
            onGammaChange={(side: 'buy' | 'sell', newGamma: number) => {
              const gamma = Math.round(Math.max(1, Math.min(5, newGamma)))
              if (side === 'buy') setBuyParams((p: CurveParams) => ({ ...p, gamma }))
              else setSellParams((p: CurveParams) => ({ ...p, gamma }))
            }}
          />

          <LivePreview>
            <PreviewGrid>
              <PreviewItem>
                <PreviewKey>Buy Liquidity @ 30%</PreviewKey>
                <PreviewVal color="#34d399">{midLiqPreview.midBuy.toFixed(2)}</PreviewVal>
              </PreviewItem>
              <PreviewItem>
                <PreviewKey>Sell Liquidity @ 30%</PreviewKey>
                <PreviewVal color="#f87171">{midLiqPreview.midSell.toFixed(2)}</PreviewVal>
              </PreviewItem>
              <PreviewItem>
                <PreviewKey>Buy γ style</PreviewKey>
                <PreviewVal>{GAMMA_LABELS[buyParams.gamma]}</PreviewVal>
              </PreviewItem>
              <PreviewItem>
                <PreviewKey>Sell γ style</PreviewKey>
                <PreviewVal>{GAMMA_LABELS[sellParams.gamma]}</PreviewVal>
              </PreviewItem>
            </PreviewGrid>
          </LivePreview>

          {/* Buy Curve Controls */}
          <SubSectionTitle>Buy Curve Parameters</SubSectionTitle>
          <SliderGroup>
            <SliderRow>
              <SliderLabel>
                Curvature γ <SliderHint>({GAMMA_LABELS[buyParams.gamma]})</SliderHint>
              </SliderLabel>
              <Slider
                type="range" min={1} max={5} step={1}
                value={buyParams.gamma}
                onChange={(e) => setBuyParams((p: CurveParams) => ({ ...p, gamma: Number(e.target.value) }))}
              />
              <SliderValue>{buyParams.gamma}</SliderValue>
            </SliderRow>

            <SliderRow>
              <SliderLabel>Max Capacity (LUSDT)</SliderLabel>
              <Slider
                type="range" min={1000} max={50000} step={1000}
                value={buyParams.x0}
                onChange={(e) => setBuyParams((p: CurveParams) => ({ ...p, x0: Number(e.target.value) }))}
              />
              <SliderValue>{(buyParams.x0 / 1000).toFixed(0)}k</SliderValue>
            </SliderRow>

            <SliderRow>
              <SliderLabel>Fee Target (bps)</SliderLabel>
              <Slider
                type="range" min={1} max={100} step={1}
                value={Math.round(buyParams.feeT * 10000)}
                onChange={(e) => setBuyParams((p: CurveParams) => ({ ...p, feeT: Number(e.target.value) / 10000 }))}
              />
              <SliderValue>{Math.round(buyParams.feeT * 10000)}</SliderValue>
            </SliderRow>
          </SliderGroup>

          {/* Sell Curve Controls */}
          <SubSectionTitle>Sell Curve Parameters</SubSectionTitle>
          <SliderGroup>
            <SliderRow>
              <SliderLabel>
                Curvature γ <SliderHint>({GAMMA_LABELS[sellParams.gamma]})</SliderHint>
              </SliderLabel>
              <Slider
                type="range" min={1} max={5} step={1}
                value={sellParams.gamma}
                onChange={(e) => setSellParams((p: CurveParams) => ({ ...p, gamma: Number(e.target.value) }))}
              />
              <SliderValue>{sellParams.gamma}</SliderValue>
            </SliderRow>

            <SliderRow>
              <SliderLabel>Max Capacity (LUNES)</SliderLabel>
              <Slider
                type="range" min={1000} max={50000} step={1000}
                value={sellParams.x0}
                onChange={(e) => setSellParams((p: CurveParams) => ({ ...p, x0: Number(e.target.value) }))}
              />
              <SliderValue>{(sellParams.x0 / 1000).toFixed(0)}k</SliderValue>
            </SliderRow>

            <SliderRow>
              <SliderLabel>Fee Target (bps)</SliderLabel>
              <Slider
                type="range" min={1} max={100} step={1}
                value={Math.round(sellParams.feeT * 10000)}
                onChange={(e) => setSellParams((p: CurveParams) => ({ ...p, feeT: Number(e.target.value) / 10000 }))}
              />
              <SliderValue>{Math.round(sellParams.feeT * 10000)}</SliderValue>
            </SliderRow>
          </SliderGroup>

          {!isConnected ? (
            <Button onClick={() => connectWallet()}>Connect Wallet to Deploy</Button>
          ) : (
            <Button onClick={() => { resetDeploy(); setShowDeployModal(true) }}>
              Deploy Asymmetric Strategy
            </Button>
          )}
        </>
      )}

      {/* ── Delegate Tab ───────────────────────────────────────────── */}
      {activeTab === 'delegate' && (
        <>
          <DelegateCard>
            <DelegateTitle>
              <Bot size={20} style={{ color: 'currentColor' }} />
              AI Agent Delegation
            </DelegateTitle>
            <DelegateDescription>
              Generate a restricted API Key that gives an AI agent (OpenClaw, Phidata, or any MCP-compatible
              orchestrator) permission to dynamically adjust your curve parameters — without ever being
              able to withdraw your funds.
            </DelegateDescription>

            <FeatureList>
              <FeatureItem>Agent can only call update_curve_parameters()</FeatureItem>
              <FeatureItem>You set γ guardrails — agent can&apos;t exceed your limits</FeatureItem>
              <FeatureItem>Key expires in 90 days — auto-renewable</FeatureItem>
              <FeatureItem>All actions logged in AsymmetricRebalanceLog</FeatureItem>
            </FeatureList>

            <Button onClick={() => setShowDelegate(true)}>
              Generate Restricted API Key
            </Button>
          </DelegateCard>
        </>
      )}

      {/* Modals */}
      {showDelegate && (
        <AgentDelegationPanel onClose={() => setShowDelegate(false)} />
      )}

      {showDeployModal && (
        <DeployOverlay onClick={(e) => e.target === e.currentTarget && deployState.step === 'idle' && setShowDeployModal(false)}>
          <DeployModal>
            {(deployState.step === 'idle' || deployState.step === 'error') && (
              <button
                onClick={() => setShowDeployModal(false)}
                style={{
                  width: '40px', height: '40px', fontSize: '20px', cursor: 'pointer',
                  color: 'inherit', border: 'none', background: 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  position: 'absolute', top: '8px', right: '8px',
                  transition: 'transform 0.3s ease-in-out, color 0.2s ease'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'rotate(-180deg)'; e.currentTarget.style.color = '#6C38FE'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'rotate(0deg)'; e.currentTarget.style.color = 'inherit'; }}
              >
                ✕
              </button>
            )}

            <DeployModalTitle>Deploy Asymmetric Strategy</DeployModalTitle>

            {deployState.step === 'idle' && (
              <>
                <DeployModalNote>
                  Your wallet will sign <strong>2 transactions</strong>:<br />
                  1. Instantiate the AsymmetricPair contract (you become the owner)<br />
                  2. Seed initial liquidity — buy k = <strong>{buyParams.k}</strong>, sell k = <strong>{Math.round(sellParams.k * 0.5)}</strong>
                </DeployModalNote>
                <RowButtons>
                  <Button style={{ flex: 1 }} onClick={handleDeploy}>Confirm & Deploy</Button>
                  <Button status="secondary" width="auto" style={{ padding: '0 24px', minWidth: '120px' }} onClick={() => setShowDeployModal(false)}>Cancel</Button>
                </RowButtons>
              </>
            )}

            {deployState.step === 'fetching' && (
              <StatusBox variant="loading">Fetching verified contract bundle...</StatusBox>
            )}
            {deployState.step === 'instantiating' && (
              <StatusBox variant="loading">
                Step 1/2 — Instantiating contract on-chain...<br />
                <span style={{ fontSize: '11px', opacity: 0.7 }}>Sign the transaction in your wallet</span>
              </StatusBox>
            )}
            {deployState.step === 'deploying' && (
              <StatusBox variant="loading">
                Step 2/2 — Seeding initial liquidity...<br />
                <span style={{ fontSize: '11px', opacity: 0.7 }}>Sign the second transaction in your wallet</span>
              </StatusBox>
            )}
            {deployState.step === 'registering' && (
              <StatusBox variant="loading">Registering strategy on backend...</StatusBox>
            )}

            {deployState.step === 'done' && (
              <>
                <StatusBox variant="success">
                  ✓ Strategy deployed successfully!
                  <TxHashLink>{deployState.contractAddress}</TxHashLink>
                  <TxHashLink style={{ opacity: 0.5 }}>{deployState.txHash}</TxHashLink>
                </StatusBox>
                <Button onClick={() => { setShowDeployModal(false); resetDeploy() }}>Close</Button>
              </>
            )}

            {deployState.step === 'error' && (
              <>
                <StatusBox variant="error">{deployState.error}</StatusBox>
                <RowButtons>
                  <Button style={{ flex: 1 }} onClick={handleDeploy}>Try Again</Button>
                  <Button status="secondary" width="auto" style={{ padding: '0 24px', minWidth: '120px' }} onClick={() => { setShowDeployModal(false); resetDeploy() }}>Cancel</Button>
                </RowButtons>
              </>
            )}
          </DeployModal>
        </DeployOverlay>
      )}
    </PageLayout>
  )
}

export default AsymmetricPool
