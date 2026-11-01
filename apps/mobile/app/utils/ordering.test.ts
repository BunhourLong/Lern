import type { Offer, Ride } from '@lern/contracts';
import { keepNewer, keepOffer, keepRide } from './ordering';

const ride = (
  id: string,
  version: number,
  status: Ride['status'] = 'searching',
) => ({ id, version, status } as Ride);
const offer = (id: string, status: Offer['status']) =>
  ({ id, status } as Offer);

describe('keepRide (invariant 8: seq = version)', () => {
  it('takes a newer version of the same ride and ignores an older or repeated one', () => {
    expect(keepRide(ride('a', 2), ride('a', 3))).toEqual(ride('a', 3));
    expect(keepRide(ride('a', 3), ride('a', 3))).toEqual(ride('a', 3));
    expect(keepRide(ride('a', 3), ride('a', 2))).toEqual(ride('a', 3));
    expect(keepRide(null, ride('a', 1))).toEqual(ride('a', 1));
  });

  it('moves on to another ride only once the held one has ended, so a late event of an old ride is ignored', () => {
    expect(keepRide(ride('a', 5, 'completed'), ride('b', 1))).toEqual(
      ride('b', 1),
    );
    expect(keepRide(ride('b', 1), ride('a', 5, 'completed'))).toEqual(
      ride('b', 1),
    );
  });
});

describe('keepOffer (no seq: a final status beats pending)', () => {
  it('lets a final status replace pending, never the reverse, and keeps the first final', () => {
    expect(keepOffer(offer('o', 'pending'), offer('o', 'expired'))).toEqual(
      offer('o', 'expired'),
    );
    expect(keepOffer(offer('o', 'expired'), offer('o', 'pending'))).toEqual(
      offer('o', 'expired'),
    );
    expect(keepOffer(offer('o', 'expired'), offer('o', 'accepted'))).toEqual(
      offer('o', 'expired'),
    );
  });

  it('takes a new pending offer, but not a late final of an offer it no longer holds', () => {
    expect(keepOffer(offer('old', 'expired'), offer('new', 'pending'))).toEqual(
      offer('new', 'pending'),
    );
    expect(
      keepOffer(offer('lost', 'pending'), offer('new', 'pending')),
    ).toEqual(offer('new', 'pending'));
    expect(keepOffer(offer('new', 'pending'), offer('old', 'expired'))).toEqual(
      offer('new', 'pending'),
    );
    expect(keepOffer(null, offer('o', 'cancelled'))).toEqual(
      offer('o', 'cancelled'),
    );
  });
});

it('keepNewer compares ISO instants, not strings', () => {
  const at = (iso: string) => ({ iso });
  expect(
    keepNewer(
      at('2026-11-01T10:00:00.000Z'),
      at('2026-11-01T17:00:00+07:00'),
      x => x.iso,
    ),
  ).toEqual(at('2026-11-01T10:00:00.000Z'));
  expect(
    keepNewer(
      at('2026-11-01T10:00:00.000Z'),
      at('2026-11-01T10:00:00.001Z'),
      x => x.iso,
    ),
  ).toEqual(at('2026-11-01T10:00:00.001Z'));
  expect(
    keepNewer(undefined, at('2026-11-01T10:00:00.000Z'), x => x.iso),
  ).toEqual(at('2026-11-01T10:00:00.000Z'));
});
