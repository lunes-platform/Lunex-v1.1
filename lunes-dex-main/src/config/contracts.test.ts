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

it('reads the spot settlement vault and keeps Margin off unless explicitly enabled', async () => {
  const source = readFileSync(
    new URL('./contracts.ts', import.meta.url),
    'utf8'
  )
  const load = async (define: Record<string, string>) => {
    const result = await transformWithEsbuild(source, 'contracts.ts', {
      format: 'cjs',
      define: { 'process.env': '{}', ...define }
    })
    const module = {
      exports: {} as {
        CONTRACTS: Record<string, string>
        FEATURES: Record<string, boolean>
      }
    }
    new Function('module', result.code)(module)
    return module.exports
  }
  const unset = await load({})
  expect(unset.CONTRACTS.SPOT_SETTLEMENT).toBe('')
  expect(unset.FEATURES.MARGIN).toBe(false)
  const set = await load({
    'process.env.REACT_APP_SPOT_SETTLEMENT_CONTRACT': '"configured-vault"',
    'process.env.REACT_APP_FEATURE_MARGIN': '"true"'
  })
  expect(set.CONTRACTS.SPOT_SETTLEMENT).toBe('configured-vault')
  expect(set.FEATURES.MARGIN).toBe(true)
  const other = await load({ 'process.env.REACT_APP_FEATURE_MARGIN': '"1"' })
  expect(other.FEATURES.MARGIN).toBe(false)
})
