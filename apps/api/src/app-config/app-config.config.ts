import type { AppConfig } from '@lern/contracts';
import type { Config } from '../shared/config/env';

export const APP_CONFIG = Symbol('APP_CONFIG');

// Computed once at boot; env.ts guarantees a platform's two keys arrive together
export function toAppConfig(config: Config): AppConfig {
  return {
    maintenance: config.MAINTENANCE,
    ios: platform(config.APP_MIN_VERSION_IOS, config.APP_STORE_URL_IOS),
    android: platform(config.APP_MIN_VERSION_ANDROID, config.APP_STORE_URL_ANDROID),
  };
}

function platform(minVersion: string | undefined, storeUrl: string | undefined): AppConfig['ios'] {
  return minVersion !== undefined && storeUrl !== undefined ? { minVersion, storeUrl } : null;
}
