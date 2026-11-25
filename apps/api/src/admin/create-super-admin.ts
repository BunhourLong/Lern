import { staffEmailSchema } from '@lern/contracts';
import type { DataSource } from 'typeorm';
import { z } from 'zod';
import { hashPassword } from './domain/password';

const superAdminSchema = z.object({
  email: staffEmailSchema,
  displayName: z.string().trim().min(1, 'Display name must not be blank'),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .max(128, 'Password must be at most 128 characters')
    .refine((s) => !s.includes('\0'), 'Password must not contain a NUL byte'),
});

// Bootstraps the first staff account (and later ones) from the CLI. Errors name the field, never the password or hash.
export async function createSuperAdmin(
  ds: DataSource,
  input: { email: string; displayName: string; password: string },
): Promise<{ id: string }> {
  const parsed = superAdminSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid input:\n${z.prettifyError(parsed.error)}`);
  const { email, displayName, password } = parsed.data;
  const passwordHash = await hashPassword(password);
  try {
    return await ds.transaction(async (tx) => {
      const [{ id }] = await tx.query<{ id: string }[]>(
        `INSERT INTO staff_users (email, display_name, is_super_admin) VALUES ($1, $2, true) RETURNING id`,
        [email, displayName],
      );
      await tx.query(`INSERT INTO staff_credentials (staff_user_id, password_hash) VALUES ($1, $2)`, [id, passwordHash]);
      return { id };
    });
  } catch (err) {
    const { code, message } = err as { code?: string; message: string };
    // The driver's error carries the query parameters, password hash included, so it never travels on as a `cause`
    // eslint-disable-next-line preserve-caught-error
    throw new Error(code === '23505' ? `A staff user with email ${email} already exists` : `Could not create the staff user: ${message}`);
  }
}
