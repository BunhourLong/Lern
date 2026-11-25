import type { MigrationInterface, QueryRunner } from 'typeorm';

// Going online sums the driver's ledger entries (M6.9), so driver_id needs an index.
export class DriverLedgerDriverIndex1795420800000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('CREATE INDEX driver_ledger_entries_driver_id_idx ON driver_ledger_entries (driver_id)');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX driver_ledger_entries_driver_id_idx');
  }
}
