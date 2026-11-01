import type { Config } from '../shared/config/env';

export const MATCHING_CONFIG = Symbol('MATCHING_CONFIG');
export type MatchingConfig = Pick<
  Config,
  'OFFER_TTL_SECONDS' | 'SEARCH_DEADLINE_SECONDS' | 'SWEEP_INTERVAL_MS' | 'RECONCILE_INTERVAL_MS' | 'MATCHING_WORKER' | 'OSRM_URL' | 'PRESENCE_INTERVAL_MS' | 'DRIVER_STALE_SECONDS' | 'DRIVER_TIMEOUT_SECONDS'
>;
