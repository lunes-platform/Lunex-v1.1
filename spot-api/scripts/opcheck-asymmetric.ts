import 'dotenv/config'
import prisma from '../src/db'
import { asymmetricService } from '../src/services/asymmetricService'
import { rebalancerService } from '../src/services/rebalancerService'

async function main() {
  const pairAddress = process.env.SANDBOX_ASYMMETRIC_PAIR_CONTRACT || ''
  if (!pairAddress) {
    throw new Error('SANDBOX_ASYMMETRIC_PAIR_CONTRACT not configured')
  }

  const suffix = Date.now()
  const userAddress = `opcheck-user-${suffix}`
  const agentWallet = `opcheck-agent-wallet-${suffix}`
  let strategyId: string | null = null
  let agentId: string | null = null

  console.log('[opcheck] starting asymmetric operational check')
  console.log('[opcheck] pairAddress', pairAddress)

  try {
    const agent = await prisma.agent.create({
      data: {
        walletAddress: agentWallet,
        agentType: 'AI_AGENT',
        framework: 'Operational Check',
        strategyDescription:
          'Temporary agent for asymmetric operational validation'
      }
    })
    agentId = agent.id
    console.log('[opcheck] agent_create_ok', {
      id: agent.id,
      walletAddress: agent.walletAddress
    })

    const created = await asymmetricService.createStrategy({
      userAddress,
      pairAddress,
      isAutoRebalance: true,
      buyK: '1000',
      buyGamma: 3,
      buyMaxCapacity: '10000',
      buyFeeTargetBps: 30,
      sellGamma: 2,
      sellMaxCapacity: '8000',
      sellFeeTargetBps: 30,
      sellProfitTargetBps: 500,
      leverageL: '0',
      allocationC: 0.5
    })
    strategyId = created.id
    console.log('[opcheck] register_ok', {
      id: created.id,
      userAddress: created.userAddress,
      pairAddress: created.pairAddress
    })

    const toggled = await asymmetricService.toggleAutoRebalance(
      created.id,
      userAddress,
      false
    )
    console.log('[opcheck] toggle_ok', {
      id: toggled.id,
      isAutoRebalance: toggled.isAutoRebalance
    })

    const updated = await asymmetricService.updateCurveParams(created.id, userAddress, {
      isBuySide: true,
      newGamma: 4,
      newMaxCapacity: '12000',
      newFeeTargetBps: 35
    })
    console.log('[opcheck] update_curve_ok', {
      id: updated.id,
      buyGamma: updated.buyCurve.gamma,
      buyMaxCapacity: updated.buyCurve.maxCapacity,
      buyFeeTargetBps: updated.buyCurve.feeTargetBps
    })

    const linked = await asymmetricService.linkStrategyToAgent(
      created.id,
      agent.id,
      userAddress,
      pairAddress
    )
    console.log('[opcheck] link_agent_ok', { id: linked.id, agentId: linked.agentId })

    const logs = await asymmetricService.getRebalanceLogs(created.id, 10)
    console.log('[opcheck] audit_logs_count', logs.length)
    console.log(
      '[opcheck] audit_triggers',
      logs.map((l) => `${l.trigger}:${l.status}`)
    )

    const relayerAddress = await rebalancerService.getRelayerAddress()
    const managerAddress = await rebalancerService.getManager(pairAddress)
    const delegated = await rebalancerService.isManagedByRelayer(pairAddress)

    console.log('[opcheck] delegation_chain_state', {
      relayerAddress,
      managerAddress,
      delegated
    })

    try {
      await rebalancerService.executeAgentCurveUpdate(created.id, {
        isBuySide: false,
        newGamma: 2,
        newMaxCapacity: '7500',
        newFeeTargetBps: 28
      })
      console.log('[opcheck] agent_update_chain_ok', true)
    } catch (err: any) {
      console.log(
        '[opcheck] agent_update_chain_blocked',
        err?.message || String(err)
      )
    }
  } finally {
    if (strategyId) {
      await prisma.asymmetricRebalanceLog.deleteMany({ where: { strategyId } })
      await prisma.asymmetricStrategy.delete({ where: { id: strategyId } })
      console.log('[opcheck] cleanup_strategy_ok', strategyId)
    }
    if (agentId) {
      await prisma.agent.delete({ where: { id: agentId } })
      console.log('[opcheck] cleanup_agent_ok', agentId)
    }
    await prisma.$disconnect()
  }
}

main().catch(async (e) => {
  console.error('[opcheck] failed', e?.message || e)
  await prisma.$disconnect()
  process.exit(1)
})
