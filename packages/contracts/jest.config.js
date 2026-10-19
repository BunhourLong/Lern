/** @type {import('jest').Config} */
module.exports = { transform: { '^.+\\.ts$': 'ts-jest' }, testEnvironment: 'node', testMatch: ['<rootDir>/src/**/*.spec.ts'] };
