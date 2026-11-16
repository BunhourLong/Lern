import type { NotificationsService } from '../notifications/notifications.service';
import type { RealtimeGateway } from '../realtime/realtime.gateway';
import type { OutboxRepository } from './outbox.repository';
import { OutboxService } from './outbox.service';

// Scheduling only: what reaches the database and the sockets is covered by test/outbox.int-spec.ts
const setup = (canFanOut: boolean) => {
  const releases: (() => void)[] = [];
  const claim = jest.fn(() => new Promise<number>((resolve) => releases.push(() => resolve(0))));
  const realtime = { canFanOut: () => canFanOut } as unknown as RealtimeGateway;
  const service = new OutboxService({ claim } as unknown as OutboxRepository, realtime, {} as NotificationsService);
  service.onModuleInit();
  return { service, claim, releases };
};

it('claims nothing while this instance cannot fan out, so a healthy instance sends the rows', async () => {
  const { service, claim } = setup(false);
  service.kick();
  await service.onModuleDestroy();
  expect(claim).not.toHaveBeenCalled();
});

it('emits nothing when the pushes cannot be queued, so the retried batch does not replay to sockets every time', async () => {
  const emit = jest.fn();
  const realtime = { canFanOut: () => true, server: { to: () => ({ emit }) } } as unknown as RealtimeGateway;
  const events = [{ id: '1', topic: 't', recipients: ['u'], payload: {} }];
  const claim = jest.fn((_: number, send: (e: typeof events) => Promise<void>) => send(events));
  const enqueue = jest.fn().mockRejectedValue(new Error('redis stalled'));
  const service = new OutboxService({ claim } as unknown as OutboxRepository, realtime, { enqueue } as unknown as NotificationsService);
  service.onModuleInit();
  service.kick();
  await service.onModuleDestroy();
  expect(enqueue).toHaveBeenCalledTimes(1);
  expect(emit).not.toHaveBeenCalled();
});

it('runs one more pass for kicks that arrive during a drain', async () => {
  const { service, claim, releases } = setup(true);
  service.kick();
  service.kick(); // a row committed while the first claim is in flight
  service.kick();
  releases.shift()?.();
  await new Promise(setImmediate);
  expect(claim).toHaveBeenCalledTimes(2);
  releases.shift()?.();
  await service.onModuleDestroy();
  expect(claim).toHaveBeenCalledTimes(2);
});
