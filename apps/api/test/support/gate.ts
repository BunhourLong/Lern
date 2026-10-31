import type { DataSource } from 'typeorm';

// Race-test gate (concurrency-test skill): locks `table` so racing statements queue at the database, proves they
// overlapped by counting lock waiters, then lets them go. Waiters are counted across the whole database, so
// suites using it run on isolatedDatabase().
export async function lockTable(db: DataSource, table: string) {
  const gate = db.createQueryRunner();
  await gate.connect();
  await gate.startTransaction();
  await gate.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
  return {
    async arrived(n: number) {
      for (const end = Date.now() + 10_000; ; ) {
        const [{ waiting }] = await db.query<{ waiting: number }[]>(
          `SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
        );
        if (waiting === n) return;
        if (Date.now() > end) throw new Error(`not all ${n} racers arrived at the lock (${waiting})`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
    async release() {
      await gate.commitTransaction();
      await gate.release();
    },
  };
}
