// `pnpm --filter @lern/api staff:create-super-admin --email ops@example.com --name "Ops Lead"`: creates a staff super
// admin. The password is never a flag (shell history, ps): it is typed at a hidden prompt, or piped on stdin.
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { createDataSource } from '../shared/database/database';
import { createSuperAdmin } from './create-super-admin';

// Characters are not echoed: raw mode hands us each key, and nothing is written back
function promptHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();
  let typed = '';
  return new Promise((resolve, reject) => {
    const finish = (err?: Error) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      if (err) reject(err);
      else resolve(typed);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish();
        if (ch === '\u0003' || ch === '\u0004') return finish(new Error('Cancelled'));
        typed = ch === '\u007f' || ch === '\b' ? typed.slice(0, -1) : typed + ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function readPassword(): Promise<string> {
  if (process.stdin.isTTY) {
    const password = await promptHidden('Password: ');
    if ((await promptHidden('Repeat password: ')) !== password) throw new Error('Passwords do not match');
    return password;
  }
  process.stdin.setEncoding('utf8'); // decodes a character split across chunks whole
  let piped = '';
  for await (const chunk of process.stdin) piped += String(chunk);
  return piped.replace(/\r?\n$/, '');
}

async function main(): Promise<void> {
  const usage = new Error('Usage: staff:create-super-admin --email <email> --name <display name>');
  let values: { email?: string; name?: string };
  try {
    ({ values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } }));
  } catch {
    throw usage; // parseArgs quotes the offending argument, which may be a password typed as one
  }
  if (!values.email || !values.name) throw usage;
  // Only the database is needed, so the API's full env (Redis, OTP, push) isn't required here
  const url = z.url({ protocol: /^postgres(ql)?$/ }).safeParse(process.env.DATABASE_URL);
  if (!url.success) throw new Error('DATABASE_URL must be set to a postgres:// URL');
  const password = await readPassword();
  const db = await createDataSource(url.data).initialize();
  try {
    const { id } = await createSuperAdmin(db, { email: values.email, displayName: values.name, password });
    console.log(`Created super admin ${id}`);
  } finally {
    await db.destroy();
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exitCode = 1;
});
