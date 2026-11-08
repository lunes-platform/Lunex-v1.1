/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Each deploy waits for block inclusion; slow-block dev nodes need headroom.
  testTimeout: 120000,
  setupFilesAfterEnv: ['./tests/setupApi.ts'],
  transform: {
    // The generated typechain bindings mix the root @polkadot/api (v10) with
    // the v9 copy typechain-types bundles, so they never type-check; the specs
    // themselves still do.
    '^.+\\.tsx?$': ['ts-jest', { diagnostics: { exclude: ['**/types/**'] } }],
  },
};
