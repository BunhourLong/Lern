import { nearestIdle } from './hand-off';

const pickup = { lat: 11.56, lng: 104.92 };
const at = (id: string, lat: number, idle = true) => ({ id, idle, position: { lat, lng: 104.92 } });

describe('nearestIdle', () => {
  it('picks the idle driver nearest the pickup', () => {
    const drivers = [at('far', 11.58), at('near', 11.561), at('mid', 11.565)];
    expect(nearestIdle(drivers, pickup)?.id).toBe('near');
  });

  it('skips busy drivers, however close', () => {
    const drivers = [at('busy', 11.5601, false), at('free', 11.57)];
    expect(nearestIdle(drivers, pickup)?.id).toBe('free');
  });

  it('returns undefined when nobody is idle', () => {
    expect(nearestIdle([at('busy', 11.56, false)], pickup)).toBeUndefined();
    expect(nearestIdle([], pickup)).toBeUndefined();
  });
});
