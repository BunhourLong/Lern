import type { MigrationInterface, QueryRunner } from 'typeorm';

// M6.7: a card carries the platform's rate (basis points of trip + surge), and booking snapshots the commission
// on the ride from the quote's card (invariant 6), so a later card never changes what an earlier ride owes.
export class RidesCommission1795248000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // ADD COLUMN fills existing cards without firing rate_cards_append_only; an UPDATE would hit it.
    // The default only seeds the existing cards (placeholder 15%): every new card must name its rate.
    await q.query(
      `ALTER TABLE rate_cards ADD COLUMN commission_bp integer NOT NULL DEFAULT 1500
         CONSTRAINT rate_cards_commission_bp_range CHECK (commission_bp BETWEEN 0 AND 10000)`,
    );
    await q.query('ALTER TABLE rate_cards ALTER COLUMN commission_bp DROP DEFAULT');
    await q.query('ALTER TABLE rides ADD COLUMN commission_bp integer, ADD COLUMN commission_minor bigint');
    // Mirrors commission() in pricing/domain/fare.ts (ceilToRiel of (trip + surge) × bp / 10000, plus the fee) in
    // integer maths: trip + surge is whole 100 riel, so ceil to 100 is ceil((t + s) × bp / 1 000 000) × 100.
    await q.query(
      `UPDATE rides SET commission_bp = c.commission_bp,
         commission_minor = (((qu.breakdown->>'tripMinor')::bigint + (qu.breakdown->>'surgeMinor')::bigint) * c.commission_bp
                             + 999999) / 1000000 * 100 + (qu.breakdown->>'bookingFeeMinor')::bigint
       FROM quotes qu JOIN rate_cards c ON c.id = qu.rate_card_id
       WHERE qu.id = rides.quote_id`,
    );
    await q.query(
      `ALTER TABLE rides ALTER COLUMN commission_bp SET NOT NULL, ALTER COLUMN commission_minor SET NOT NULL,
         ADD CONSTRAINT rides_commission_bp_range CHECK (commission_bp BETWEEN 0 AND 10000),
         ADD CONSTRAINT rides_commission_within_fare CHECK (commission_minor >= 0 AND commission_minor <= fare_minor)`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE rides DROP COLUMN commission_minor, DROP COLUMN commission_bp');
    await q.query('ALTER TABLE rate_cards DROP COLUMN commission_bp');
  }
}
