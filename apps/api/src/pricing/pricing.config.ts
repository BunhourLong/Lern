import type { Config } from '../shared/config/env';

export const PRICING_CONFIG = Symbol('PRICING_CONFIG');
export type PricingConfig = Pick<Config, 'OSRM_URL'>;
