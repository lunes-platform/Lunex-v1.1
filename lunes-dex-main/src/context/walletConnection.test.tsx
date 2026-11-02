import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SDKProvider, useSDK } from './SDKContext'

const mocks = vi.hoisted(() => ({
  connected: false,
  signRaw: vi.fn(),
  service: {
    setContracts: vi.fn(),
    disconnect: vi.fn(),
    getIsConnected: vi.fn(),
    connect: vi.fn(),
    getNativeBalance: vi.fn()
  }
}))
vi.mock('../services/contractService', () => ({
  contractService: mocks.service
}))
vi.mock('@polkadot/extension-dapp', () => ({
  web3FromSource: async () => ({ signer: { signRaw: mocks.signRaw } }),
  web3Enable: async () => [{}],
  web3Accounts: async () => [
    { address: 'bob', meta: { source: 'polkadot-js' } }
  ]
}))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: Root
let sdk: ReturnType<typeof useSDK>
function Consumer() {
  sdk = useSDK()
  return <div>{sdk.isConnected ? 'Connected' : 'Disconnected'}</div>
}
beforeEach(async () => {
  mocks.connected = false
  mocks.service.getIsConnected.mockImplementation(() => mocks.connected)
  mocks.service.getNativeBalance.mockResolvedValue('100000000')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      <SDKProvider>
        <Consumer />
      </SDKProvider>
    )
  )
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  localStorage.clear()
})

it('waits for the RPC before publishing the wallet and starting balance polling', async () => {
  let release!: (ready: boolean) => void
  mocks.service.connect.mockImplementation(
    () =>
      new Promise(resolve => {
        release = ready => {
          mocks.connected = ready
          resolve(ready)
        }
      })
  )
  let connection!: Promise<void>
  await act(async () => {
    connection = sdk.connectWallet()
  })
  expect(sdk.isConnected).toBe(false)
  expect(sdk.walletAddress).toBeNull()
  expect(mocks.service.getNativeBalance).not.toHaveBeenCalled()
  await act(async () => {
    release(true)
    await connection
  })
  expect(sdk.isConnected).toBe(true)
  expect(sdk.walletAddress).toBe('bob')
})

it('keeps the wallet disconnected if the blockchain connection fails', async () => {
  mocks.service.connect.mockResolvedValue(false)
  await act(async () => {
    await sdk.connectWallet()
  })
  expect(sdk.isConnected).toBe(false)
  expect(sdk.walletAddress).toBeNull()
  expect(sdk.error).toBeTruthy()
})

it('passes hex-encoded UTF-8 bytes to the wallet raw signer', async () => {
  mocks.service.connect.mockImplementation(async () => {
    mocks.connected = true
    return true
  })
  mocks.signRaw.mockResolvedValue({ signature: '0xsigned' })
  await act(async () => {
    await sdk.connectWallet()
  })
  expect(sdk.error).toBeNull()
  expect(await sdk.signMessage('Olá Lunex\nnonce:123')).toBe('0xsigned')
  expect(mocks.signRaw).toHaveBeenCalledWith({
    address: 'bob',
    data: '0x4f6cc3a1204c756e65780a6e6f6e63653a313233',
    type: 'bytes'
  })
})
