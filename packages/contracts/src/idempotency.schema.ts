import { z } from 'zod';

// Send a fresh UUID per user action on mutating requests, and the same one on every retry of that action
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const idempotencyKeySchema = z.uuid();
