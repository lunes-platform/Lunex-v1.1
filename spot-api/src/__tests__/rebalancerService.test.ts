import { rebalancerService } from '../services/rebalancerService'

describe('rebalancerService.isManagedByRelayer', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns true when manager address matches relayer address', async () => {
    jest.spyOn(rebalancerService, 'getManager').mockResolvedValue('5Fmanager')
    jest
      .spyOn(rebalancerService, 'getRelayerAddress')
      .mockResolvedValue('5Fmanager')

    await expect(rebalancerService.isManagedByRelayer('5Fpair')).resolves.toBe(
      true
    )
  })

  it('returns false when manager is unset or mismatched', async () => {
    jest.spyOn(rebalancerService, 'getManager').mockResolvedValue(null)
    jest
      .spyOn(rebalancerService, 'getRelayerAddress')
      .mockResolvedValue('5Frelayer')

    await expect(rebalancerService.isManagedByRelayer('5Fpair')).resolves.toBe(
      false
    )
  })
})
