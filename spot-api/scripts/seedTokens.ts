/**
 * Seed Base Tokens into TokenRegistry
 *
 * Run: npx ts-node scripts/seedTokens.ts
 *
 * Seeds the core platform tokens (LUNES, LUSDT, LBTC, LETH, GMC, LUP)
 * into the TokenRegistry as trusted + verified entries.
 */

import prisma from '../src/db'

const SEED_TOKENS = [
  {
    address: process.env.REACT_APP_TOKEN_WLUNES || '5HRAv1VDeWkLnmkZAjgo6oigU5179nUDBgjKX4u5wztM7tTo',
    symbol: 'WLUNES',
    name: 'Wrapped Lunes',
    decimals: 8,
    logoURI: '/tokens/WLUNES.svg',
    isVerified: true,
    isTrusted: true,
    source: 'SEED',
  },
  {
    address: process.env.REACT_APP_TOKEN_LUSDT || '5CdLQGeA89rffQrfckqB8cX3qQkMauszo7rqt5QaNYChsXsf',
    symbol: 'LUSDT',
    name: 'Lunes USD Tether',
    decimals: 6,
    logoURI: '/tokens/LUSDT.svg',
    isVerified: true,
    isTrusted: true,
    source: 'SEED',
  },
  {
    address: process.env.REACT_APP_TOKEN_LBTC || '5FvT73acgKALbPEqwAdah8pY28LL5EE4fNBzCgmgjTkmdsMg',
    symbol: 'LBTC',
    name: 'Lunes Bitcoin',
    decimals: 8,
    logoURI: '/tokens/LBTC.svg',
    isVerified: true,
    isTrusted: true,
    source: 'SEED',
  },
  {
    address: process.env.REACT_APP_TOKEN_LETH || '5DhVzePc99qpcmmm9yA8ZzSRPuLXp8dEc8nSZmQVyczHRGNS',
    symbol: 'LETH',
    name: 'Lunes Ethereum',
    decimals: 18,
    logoURI: '/tokens/LETH.svg',
    isVerified: true,
    isTrusted: true,
    source: 'SEED',
  },
  {
    address: process.env.REACT_APP_TOKEN_GMC || '5CfB22jZ43hkK5ZPhaaVk9wefMgTnERsawE8e9urdkMNEMRJ',
    symbol: 'GMC',
    name: 'GameCoin',
    decimals: 8,
    logoURI: '/tokens/GMC.svg',
    isVerified: true,
    isTrusted: false,
    source: 'SEED',
  },
  {
    address: process.env.REACT_APP_TOKEN_LUP || '5ELQTeXGvjijzJ7zUtTtLmm6rf44ogMnFBsT7tfYzDuzuvW3',
    symbol: 'LUP',
    name: 'Lunex Protocol',
    decimals: 8,
    logoURI: '/tokens/LUP.svg',
    isVerified: true,
    isTrusted: true,
    source: 'SEED',
  },
]

async function main() {
  console.log('Seeding TokenRegistry with base tokens...\n')

  for (const token of SEED_TOKENS) {
    const existing = await prisma.tokenRegistry.findUnique({
      where: { address: token.address },
    })

    if (existing) {
      await prisma.tokenRegistry.update({
        where: { address: token.address },
        data: token,
      })
      console.log(`  ✓ Updated: ${token.symbol} (${token.address.slice(0, 12)}...)`)
    } else {
      await prisma.tokenRegistry.create({ data: token })
      console.log(`  ✓ Created: ${token.symbol} (${token.address.slice(0, 12)}...)`)
    }
  }

  console.log(`\nDone! ${SEED_TOKENS.length} tokens seeded.`)
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
