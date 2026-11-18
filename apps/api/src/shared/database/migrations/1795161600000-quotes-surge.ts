import type { MigrationInterface, QueryRunner } from 'typeorm';

// M6.6: a quote snapshots its surge multiplier and its receipt lines (trip, surge, booking fee in whole riel,
// summing to amount_minor). The fee must be whole 100 riel so ceil(trip + fee) = ceil(trip) + fee: that keeps
// the lines summing and every older price unchanged at 1.0x, and makes the backfill below exact.
export class QuotesSurge1795161600000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE rate_cards ADD CONSTRAINT rate_cards_booking_fee_step CHECK (booking_fee % 100 = 0)');
    await q.query('ALTER TABLE quotes ADD COLUMN surge_bp integer NOT NULL DEFAULT 10000 CHECK (surge_bp >= 10000)');
    await q.query('ALTER TABLE quotes ALTER COLUMN surge_bp DROP DEFAULT');
    await q.query('ALTER TABLE quotes ADD COLUMN breakdown jsonb');
    await q.query(
      `UPDATE quotes SET breakdown = jsonb_build_object(
         'tripMinor', quotes.amount_minor - c.booking_fee, 'surgeMinor', 0, 'bookingFeeMinor', c.booking_fee)
       FROM rate_cards c WHERE c.id = quotes.rate_card_id`,
    );
    await q.query('ALTER TABLE quotes ALTER COLUMN breakdown SET NOT NULL');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE quotes DROP COLUMN breakdown');
    await q.query('ALTER TABLE quotes DROP COLUMN surge_bp');
    await q.query('ALTER TABLE rate_cards DROP CONSTRAINT rate_cards_booking_fee_step');
  }
}
