module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      files: ['app/**/*.{ts,tsx}'],
      excludedFiles: ['app/theme/**'],
      rules: {
        'react-native/no-color-literals': 'error',
        'react-native/no-inline-styles': 'error',
      },
    },
    {
      // The temporary debug screen already uses an inline content container style.
      files: ['app/screens/Debug/DebugScreen.tsx'],
      rules: { 'react-native/no-inline-styles': 'off' },
    },
  ],
};
