import type { StartedTestContainer } from 'testcontainers';

export default async function globalTeardown(): Promise<void> {
  const { __containers = [] } = globalThis as { __containers?: StartedTestContainer[] };
  await Promise.all(__containers.map((c) => c.stop()));
}
