export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  // A short number starting with 855 can be a local number.
  const local =
    digits.startsWith('855') &&
    (input.trimStart().startsWith('+') || digits.length > 9)
      ? digits.slice(3)
      : digits;
  return '+855' + local.replace(/^0/, '');
}
