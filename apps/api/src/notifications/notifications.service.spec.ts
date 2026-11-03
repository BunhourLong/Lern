import { NotificationsService } from './notifications.service';
import type { NotificationsRepository } from './notifications.repository';
import type { PushProvider } from './push.provider';
import type { PushQueue } from './push-queue';

const cancelled = {
  id: '1',
  topic: 'ride:updated',
  recipients: ['rider'],
  payload: {
    id: '5f2c1a6e-0b1d-4c3e-9a77-1f2e3d4c5b6a',
    status: 'cancelled',
    version: 3,
    vehicleType: 'moto',
    pickup: { lat: 11.5, lng: 104.9 },
    dropoff: { lat: 11.6, lng: 104.9 },
    fare: { amountMinor: 500, currency: 'USD' },
  },
};
const service = (addBulk: jest.Mock) =>
  new NotificationsService({} as NotificationsRepository, {} as PushProvider, { addBulk } as unknown as PushQueue);

// BullMQ waits for Redis without limit, and this runs inside the outbox claim's transaction: a stall must fail it
// (the rows stay, the deterministic job id makes the eventual late add harmless) instead of holding it open
it('gives up on a queue that does not answer', async () => {
  jest.useFakeTimers();
  const pending = service(jest.fn(() => new Promise(() => {}))).enqueue([cancelled]);
  const outcome = expect(pending).rejects.toThrow(/timed out/);
  await jest.advanceTimersByTimeAsync(2000);
  await outcome;
  jest.useRealTimers();
});

it('queues one job per pushed event, keyed by its outbox row, and skips the rest', async () => {
  const addBulk = jest.fn().mockResolvedValue([]);
  await service(addBulk).enqueue([cancelled, { id: '2', topic: 'driver:connectivity', recipients: ['rider'], payload: {} }]);
  const [jobs] = addBulk.mock.calls[0] as [{ id: string; push: { recipients: string[] } }[]];
  expect(jobs.map((j) => [j.id, j.push.recipients])).toEqual([['1', ['rider']]]);
});

it('does not touch Redis when nothing in the batch is pushed', async () => {
  const addBulk = jest.fn();
  await service(addBulk).enqueue([{ id: '2', topic: 'driver:connectivity', recipients: ['rider'], payload: {} }]);
  expect(addBulk).not.toHaveBeenCalled();
});
