import { phoneSchema } from '@lern/contracts';
import { normalizePhone } from './normalize-phone';

test.each([
  ['012 345 678', '+85512345678'],
  ['12345678', '+85512345678'],
  ['+855 12 345 678', '+85512345678'],
  ['85512345678', '+85512345678'],
  ['85512345', '+85585512345'],
])('normalizes %s to %s', (input, phone) => {
  expect(normalizePhone(input)).toBe(phone);
  expect(phoneSchema.safeParse(phone).success).toBe(true);
});

test.each([
  ['01234', '+8551234'],
  ['0012345678', '+855012345678'],
  ['+85512345', '+85512345'],
])('leaves %s invalid after normalization', (input, phone) => {
  const normalized = normalizePhone(input);
  expect(phoneSchema.safeParse(normalized).success).toBe(false);
  expect(normalized).toBe(phone);
});
