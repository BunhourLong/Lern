/** @type {import('jest').Config} */
const ts = { transform: { '^.+\\.ts$': 'ts-jest' }, testEnvironment: 'node' };

module.exports = {
  projects: [
    { ...ts, displayName: 'unit', testMatch: ['<rootDir>/src/**/*.spec.ts'] },
    {
      ...ts,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/**/*.int-spec.ts'],
      // Containers start once per run; workers read their URLs from env
      globalSetup: '<rootDir>/test/global-setup.ts',
      globalTeardown: '<rootDir>/test/global-teardown.ts',
    },
  ],
};
