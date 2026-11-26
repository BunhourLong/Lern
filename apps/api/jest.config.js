/** @type {import('jest').Config} */
const ts = {
  transform: {
    '^.+\\.ts$': 'ts-jest',
    // jose (the Duo SDK's JWT library) ships ESM only, and Jest can't require() ESM without
    // --experimental-vm-modules: compile just it to CommonJS. Node itself loads it natively at runtime.
    '/node_modules/jose/.+\\.js$': ['ts-jest', { tsconfig: { allowJs: true, module: 'commonjs', moduleResolution: 'node10' } }],
  },
  transformIgnorePatterns: ['/node_modules/(?!jose/)'],
  testEnvironment: 'node',
  // Workspace packages resolve to their TypeScript source, so tests never run a stale build
  testEnvironmentOptions: { customExportConditions: ['node', 'node-addons', 'source'] },
};

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
