import { DataSource } from 'typeorm';
import { createDataSource } from '../src/shared/database/database';
import { lockTable } from './support/gate';
import { isolatedDatabase } from './support/isolated-database';

let db: DataSource;

beforeAll(async () => {
  db = await createDataSource(await isolatedDatabase()).initialize();
});

afterAll(() => db.destroy());

// Takes the table lock in a fresh transaction; fails with a lock_timeout error while a gate still holds it
const canLock = async (table: string) => {
  const runner = db.createQueryRunner();
  await runner.connect();
  try {
    await runner.startTransaction();
    await runner.query(`SET LOCAL lock_timeout = '1s'`);
    await runner.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
    await runner.rollbackTransaction();
  } finally {
    await runner.release();
  }
};

describe('lockTable gate', () => {
  it('releases the lock when its scope exits by a throw', async () => {
    await expect(async () => {
      await using gate = await lockTable(db, 'rides');
      expect(gate).toBeDefined();
      throw new Error('boom');
    }).rejects.toThrow('boom');

    await expect(canLock('rides')).resolves.toBeUndefined();
  });

  it('ignores a second release, including the one at scope exit', async () => {
    await using gate = await lockTable(db, 'drivers');
    await gate.release();
    await expect(gate.release()).resolves.toBeUndefined();
  });
});
