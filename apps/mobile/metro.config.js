const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  // pnpm hoists deps (and links workspace packages) at the repo root
  watchFolders: [path.resolve(__dirname, '../..')],
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
