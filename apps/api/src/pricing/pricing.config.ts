import type { Config } from '../shared/config/env';

export const PRICING_CONFIG = Symbol('PRICING_CONFIG');
export type PricingConfig = Pick<
  Config,
  'OSRM_URL' | 'SURGE_SLOPE_BP' | 'SURGE_CAP_BP' | 'SURGE_MAX_STEP_BP' | 'SURGE_INTERVAL_MS' | 'QUEUE_PREFIX'
>;
