import type { Config } from '../shared/config/env';

export const DRIVERS_CONFIG = Symbol('DRIVERS_CONFIG');
export type DriversConfig = Pick<Config, 'DRIVER_DEBT_LIMIT_MINOR'>;
