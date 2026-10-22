import type { RealtimeGateway } from '../realtime/realtime.gateway';
import type { OutboxRepository } from './outbox.repository';
import { OutboxService } from './outbox.service';

// Scheduling only: what reaches the database and the sockets is covered by test/outbox.int-spec.ts
const setup = (canFanOut: boolean) => {
  const releases: (() => void)[] = [];
  const claim = jest.fn(() => new Promise<number>((resolve) => releases.push(() => resolve(0))));
  const realtime = { canFanOut: () => canFanOut } as unknown as RealtimeGateway;
  const service = new OutboxService({ claim } as unknown as OutboxRepository, realtime);
  service.onModuleInit();
  return { service, claim, releases };
};

it('claims nothing while this instance cannot fan out, so a healthy instance sends the rows', async () => {
  const { service, claim } = setup(false);
  service.kick();
  await service.onModuleDestroy();
  expect(claim).not.toHaveBeenCalled();
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
