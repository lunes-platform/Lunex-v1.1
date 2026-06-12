import * as fs from 'fs';
import * as path from 'path';

const fundMovingServiceFiles = [
  'services/rewardPayoutService.ts',
  'services/rebalancerService.ts',
  'services/emergencyService.ts',
];

describe('fund-moving finality regression guard', () => {
  it.each(fundMovingServiceFiles)(
    '%s does not resolve transaction success from isInBlock',
    (relativeFile) => {
      const source = fs.readFileSync(
        path.join(__dirname, '..', relativeFile),
        'utf8',
      );

      expect(source).not.toMatch(/status\.isInBlock/);
      expect(source).not.toMatch(/txResult\.status\.isInBlock/);
      expect(source).not.toMatch(/isInBlock\s*\|\|\s*.*isFinalized/);
      expect(source).not.toMatch(/isFinalized\s*\|\|\s*.*isInBlock/);
    },
  );
});
