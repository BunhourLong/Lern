module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: { '^@theme$': '<rootDir>/app/theme/index' },
  // RN lazy getters trigger cold babel-jest transforms inside the first test, which can exceed 5s under parallel CI load
  testTimeout: 15000,
  // The preset transforms only react-native itself; native-module packages (mmkv, nitro, keychain) ship ESM too, as does @react-navigation
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native[^/]*|@react-native(-community)?|@react-navigation)/)',
  ],
};
