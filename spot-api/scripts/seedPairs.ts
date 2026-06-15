/**
 * Seed trading Pairs into the Pair table (idempotent upsert by symbol).
 *
 * Run: npx ts-node scripts/seedPairs.ts
 *
 * Registers the 5 core spot pairs (WLUNES, LBTC, LETH, GMC, LUP — all /LUSDT)
 * using on-chain addresses from deployed-addresses.json. Idempotent: updates
 * existing rows, creates missing ones. Never drops/deletes anything.
 */

import 'dotenv/config'
import { readFileSync } from 'fs'
import { join } from 'path'
import prisma from '../src/db'

const ADDR = JSON.parse(
  readFileSync(join(__dirname, '../deployed-addresses.json'), 'utf8'),
) as Record<string, string>

type PairSeed = {
  symbol: string
  baseTokenKey: string
  baseName: string
  baseDecimals: number
  pairKey: string
}

const QUOTE = { token: ADDR.lusdt, name: 'LUSDT', decimals: 6 }

const SEED_PAIRS: PairSeed[] = [
  { symbol: 'WLUNES/LUSDT', baseTokenKey: 'wnative', baseName: 'WLUNES', baseDecimals: 8, pairKey: 'pairWlunesLusdt' },
  { symbol: 'LBTC/LUSDT', baseTokenKey: 'lbtc', baseName: 'LBTC', baseDecimals: 8, pairKey: 'pairLBTCLusdt' },
  { symbol: 'LETH/LUSDT', baseTokenKey: 'leth', baseName: 'LETH', baseDecimals: 18, pairKey: 'pairLETHLusdt' },
  { symbol: 'GMC/LUSDT', baseTokenKey: 'gmc', baseName: 'GMC', baseDecimals: 8, pairKey: 'pairGMCLusdt' },
  { symbol: 'LUP/LUSDT', baseTokenKey: 'lup', baseName: 'LUP', baseDecimals: 8, pairKey: 'pairLUPLusdt' },
]

async function main() {
  console.log('Seeding Pair table with core spot pairs...\n')

  for (const p of SEED_PAIRS) {
    const baseToken = ADDR[p.baseTokenKey]
    const pairAddress = ADDR[p.pairKey] ?? null
    if (!baseToken) {
      console.warn(`  ⚠ skip ${p.symbol}: missing base token address (${p.baseTokenKey})`)
      continue
    }
    const data = {
      symbol: p.symbol,
      baseToken,
      quoteToken: QUOTE.token,
      pairAddress,
      baseName: p.baseName,
      quoteName: QUOTE.name,
      baseDecimals: p.baseDecimals,
      quoteDecimals: QUOTE.decimals,
      isNativeBase: false,
      isNativeQuote: false,
      isActive: true,
      makerFeeBps: 10,
      takerFeeBps: 25,
    }
    try {
      const existing = await prisma.pair.findUnique({ where: { symbol: p.symbol } })
      if (existing) {
        await prisma.pair.update({ where: { symbol: p.symbol }, data })
        console.log(`  ✓ Updated: ${p.symbol} (pair ${pairAddress?.slice(0, 10)}...)`)
      } else {
        await prisma.pair.create({ data })
        console.log(`  ✓ Created: ${p.symbol} (pair ${pairAddress?.slice(0, 10)}...)`)
      }
    } catch (err) {
      console.error(`  ✗ Failed ${p.symbol}:`, (err as Error).message)
    }
  }

  const all = await prisma.pair.findMany({ where: { isActive: true }, orderBy: { symbol: 'asc' } })
  console.log(`\nActive pairs now: ${all.map((x) => x.symbol).join(', ')}`)
  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error('Seed failed:', err)
  await prisma.$disconnect()
  process.exit(1)
})
