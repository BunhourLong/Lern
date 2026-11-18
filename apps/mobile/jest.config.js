module.exports = {
  preset: '@react-native/jest-preset',
  moduleNameMapper: { '^@theme$': '<rootDir>/app/theme/index' },
  // The preset transforms only react-native itself; native-module packages (mmkv, nitro, keychain) ship ESM too
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native[^/]*|@react-native(-community)?)/)',
  ],
};
