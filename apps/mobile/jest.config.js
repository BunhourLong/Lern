module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: { '^@theme$': '<rootDir>/app/theme/index' },
  // The preset transforms only react-native itself; native-module packages (mmkv, nitro, keychain) ship ESM too, as does @react-navigation
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native[^/]*|@react-native(-community)?|@react-navigation)/)',
  ],
};
