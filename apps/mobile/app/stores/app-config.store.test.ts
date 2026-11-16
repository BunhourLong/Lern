import type { AppConfig } from '@lern/contracts';
import { appGate, createAppConfigStore } from './app-config.store';

const ios = {
  minVersion: '2.0',
  storeUrl: 'https://apps.apple.com/app/id1',
};
const android = {
  minVersion: '3.0',
  storeUrl: 'https://play.google.com/store/apps/details?id=com.lern',
};
const config = (over: Partial<AppConfig> = {}): AppConfig => ({
  maintenance: false,
  ios,
  android,
  ...over,
});

describe('appGate', () => {
  it('is ok without a config, so an unreachable API never locks users out', () => {
    expect(appGate(null, 'ios', '0.1')).toEqual({ status: 'ok' });
    expect(appGate(null, 'android', '0.1')).toEqual({ status: 'ok' });
  });

  it('is maintenance whatever the version, and maintenance wins over an update', () => {
    expect(appGate(config({ maintenance: true }), 'ios', '1.0')).toEqual({
      status: 'maintenance',
    });
    expect(appGate(config({ maintenance: true }), 'android', '99')).toEqual({
      status: 'maintenance',
    });
  });

  it('is ok when this platform has no minimum', () => {
    expect(appGate(config({ ios: null }), 'ios', '0.1')).toEqual({
      status: 'ok',
    });
    expect(appGate(config({ android: null }), 'android', '0.1')).toEqual({
      status: 'ok',
    });
  });

  it('asks to update below the minimum, with that platform’s store link', () => {
    expect(appGate(config(), 'ios', '1.9')).toEqual({
      status: 'update_required',
      storeUrl: ios.storeUrl,
    });
    expect(appGate(config(), 'android', '2.0.9')).toEqual({
      status: 'update_required',
      storeUrl: android.storeUrl,
    });
  });

  it('is ok at or above the minimum', () => {
    expect(appGate(config(), 'ios', '2.0')).toEqual({ status: 'ok' });
    expect(appGate(config(), 'ios', '2.0.1')).toEqual({ status: 'ok' });
    expect(appGate(config(), 'android', '3.0.0')).toEqual({ status: 'ok' });
  });

  it('compares numerically part by part, not as strings', () => {
    const min = (minVersion: string) => config({ ios: { ...ios, minVersion } });
    expect(appGate(min('1.10'), 'ios', '1.9')).toEqual({
      status: 'update_required',
      storeUrl: ios.storeUrl,
    });
    expect(appGate(min('1.9'), 'ios', '1.10')).toEqual({ status: 'ok' });
    expect(appGate(min('1.99.99'), 'ios', '2')).toEqual({ status: 'ok' });
  });

  it('treats missing version parts as zero', () => {
    const min = (minVersion: string) => config({ ios: { ...ios, minVersion } });
    expect(appGate(min('2'), 'ios', '2.0')).toEqual({ status: 'ok' });
    expect(appGate(min('2.0.0'), 'ios', '2')).toEqual({ status: 'ok' });
    expect(appGate(min('2.0.1'), 'ios', '2')).toEqual({
      status: 'update_required',
      storeUrl: ios.storeUrl,
    });
  });

  it("ignores the other platform's minimum", () => {
    expect(
      appGate(
        config({ android: { ...android, minVersion: '99' } }),
        'ios',
        '2.0',
      ),
    ).toEqual({ status: 'ok' });
    expect(
      appGate(config({ ios: { ...ios, minVersion: '99' } }), 'android', '3.0'),
    ).toEqual({ status: 'ok' });
  });
});

it('holds the gate once checked, null until then', () => {
  const store = createAppConfigStore();
  expect(store.getState().gate).toBeNull();
  store.getState().setGate({ status: 'maintenance' });
  expect(store.getState().gate).toEqual({ status: 'maintenance' });
});
