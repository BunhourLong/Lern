/** @type {import('jest').Config} */
module.exports = {
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  // Workspace packages resolve to their TypeScript source, so tests never run a stale build
  testEnvironmentOptions: { customExportConditions: ['node', 'node-addons', 'source'] },
};
