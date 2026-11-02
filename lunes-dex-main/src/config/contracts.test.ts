// @vitest-environment node
import { readFileSync } from 'node:fs'
import { transformWithEsbuild } from 'vite'
import { expect, it } from 'vitest'

it('preserves configured contract addresses in the production transform', async () => {
  const source = readFileSync(
    new URL('./contracts.ts', import.meta.url),
    'utf8'
  )
  const values = {
    REACT_APP_FACTORY_CONTRACT: 'configured-factory',
    REACT_APP_ROUTER_CONTRACT: 'configured-router',
    REACT_APP_WNATIVE_CONTRACT: 'configured-wrapper',
    REACT_APP_STAKING_CONTRACT: 'configured-staking',
    REACT_APP_REWARDS_CONTRACT: 'configured-rewards',
    REACT_APP_TOKEN_WLUNES: 'configured-wrapper',
    REACT_APP_TOKEN_LUSDT: 'configured-usd'
  }
  const define = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      `process.env.${key}`,
      JSON.stringify(value)
    ])
  )
  const result = await transformWithEsbuild(source, 'contracts.ts', {
    format: 'cjs',
    define: { 'process.env': '{}', ...define }
  })
  const module = {
    exports: {} as {
      CONTRACTS: Record<string, string>
      TOKENS: Record<string, string>
    }
  }
  new Function('module', result.code)(module)
  expect(module.exports.CONTRACTS.FACTORY).toBe(
    values.REACT_APP_FACTORY_CONTRACT
  )
  expect(module.exports.CONTRACTS.ROUTER).toBe(values.REACT_APP_ROUTER_CONTRACT)
  expect(module.exports.CONTRACTS.WNATIVE).toBe(
    values.REACT_APP_WNATIVE_CONTRACT
  )
  expect(module.exports.TOKENS.LUSDT).toBe(values.REACT_APP_TOKEN_LUSDT)
})
