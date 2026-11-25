import type { AppConfig } from '@lern/contracts';
import { createStore } from 'zustand/vanilla';

export type AppGate =
  | { status: 'ok' }
  | { status: 'update_required'; storeUrl: string }
  | { status: 'maintenance' };

export type AppConfigState = {
  gate: AppGate | null; // null = not checked yet
  setGate(gate: AppGate): void;
  khrPerUsd: number | null; // null = no config yet: screens show riel alone
  setKhrPerUsd(rate: number): void;
};

// Part by part as numbers, missing parts as 0: 1.0 == 1 == 1.0.0, 1.9 < 1.10
const compare = (a: string, b: string) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

// null = no answer (offline, timeout, 5xx, a rejected body): never lock users out when the API is down
export function appGate(
  config: AppConfig | null,
  platform: 'ios' | 'android',
  version: string,
): AppGate {
  if (!config) return { status: 'ok' };
  if (config.maintenance) return { status: 'maintenance' };
  const minimum = config[platform];
  if (!minimum) return { status: 'ok' };
  return compare(version, minimum.minVersion) < 0
    ? { status: 'update_required', storeUrl: minimum.storeUrl }
    : { status: 'ok' };
}

export const createAppConfigStore = () =>
  createStore<AppConfigState>()(set => ({
    gate: null,
    setGate: gate => set({ gate }),
    khrPerUsd: null,
    setKhrPerUsd: khrPerUsd => set({ khrPerUsd }),
  }));
