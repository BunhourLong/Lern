import { rankByEta } from './rank-by-eta';

// Nearest first, as the candidate query returns them
const near = { driverId: 'near', distanceM: 500 };
const mid = { driverId: 'mid', distanceM: 1000 };
const far = { driverId: 'far', distanceM: 1500 };

it('orders by road ETA, not straight-line distance (a driver across the river)', () => {
  expect(rankByEta([near, far], [900.4, 119.6])).toEqual([
    { ...far, etaS: 120 },
    { ...near, etaS: 900 },
  ]);
});

it('without ETAs (OSRM down) keeps straight-line order, estimated at 5 m/s', () => {
  expect(rankByEta([near, far], undefined)).toEqual([
    { ...near, etaS: 100 },
    { ...far, etaS: 300 },
  ]);
});

it('estimates a driver OSRM found no route for from the straight line', () => {
  expect(rankByEta([near, mid, far], [400, null, 250])).toEqual([
    { ...mid, etaS: 200 },
    { ...far, etaS: 250 },
    { ...near, etaS: 400 },
  ]);
});

it('keeps straight-line order between equal ETAs', () => {
  expect(rankByEta([near, mid, far], [60, 60, 60]).map((c) => c.driverId)).toEqual(['near', 'mid', 'far']);
});
