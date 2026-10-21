import { IDEMPOTENCY_KEY_HEADER, idempotencyKeySchema } from '@lern/contracts';
import {
  BadRequestException,
  type CallHandler,
  ConflictException,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  UnprocessableEntityException,
  UseInterceptors,
} from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { catchError, concatMap, from, type Observable, of, throwError } from 'rxjs';
import { DataSource } from 'typeorm';

type Req = {
  method: string;
  originalUrl: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  user?: { id: string };
};
type Id = [scope: string, key: string];

const derive = (purpose: string, material: string) => createHash('sha256').update(`${purpose}\0${material}`).digest();

// Responses are encrypted with a key derived from the request, which the table never stores. Where the
// request carries a strong secret (a 256-bit refresh token), a database reader can't recover the tokens
// issued for it. Don't put this on a route whose secret is guessable (an OTP code): it can be brute-forced.
function seal(body: unknown, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(body ?? null)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
}

function open(sealed: Buffer, key: Buffer): unknown {
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]).toString());
}

// Runs after the guards (so req.user is set) and before validation. Only successes are stored; a failed
// request releases its key, so the client can retry it once the problem is fixed.
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly db: DataSource) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = ctx.switchToHttp().getRequest<Req>();
    const header = req.headers[IDEMPOTENCY_KEY_HEADER.toLowerCase()];
    if (header === undefined) return next.handle();
    const parsed = idempotencyKeySchema.safeParse(header);
    if (!parsed.success) throw new BadRequestException('Idempotency-Key must be a UUID');

    const id: Id = [req.user?.id ?? 'public', parsed.data];
    const material = JSON.stringify([req.method, req.originalUrl, ...id, req.body]);
    const requestHash = derive('request', material);
    const claimed = await this.db.query<unknown[]>(
      `INSERT INTO idempotency_keys (scope, key, request_hash) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING RETURNING 1`,
      [...id, requestHash],
    );
    if (claimed.length === 0) return of(await this.replay(id, requestHash, material));

    const responseKey = derive('response', material);
    return next.handle().pipe(
      concatMap(async (body: unknown) => {
        await this.db.query('UPDATE idempotency_keys SET response = $3 WHERE scope = $1 AND key = $2', [
          ...id,
          seal(body, responseKey),
        ]);
        return body;
      }),
      catchError((err: unknown) =>
        from(this.db.query('DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2', id)).pipe(
          concatMap(() => throwError(() => err)),
        ),
      ),
    );
  }

  private async replay(id: Id, requestHash: Buffer, material: string): Promise<unknown> {
    const [row] = await this.db.query<{ request_hash: Buffer; response: Buffer | null }[]>(
      'SELECT request_hash, response FROM idempotency_keys WHERE scope = $1 AND key = $2',
      id,
    );
    if (row && !row.request_hash.equals(requestHash)) {
      throw new UnprocessableEntityException('Idempotency-Key was already used for a different request');
    }
    // No row: the first attempt failed and released the key a moment ago, so a retry will run it
    if (!row?.response) throw new ConflictException('A request with this Idempotency-Key is in progress');
    return open(row.response, derive('response', material));
  }
}

// For mutating routes: a retry with the same Idempotency-Key gets the original response instead of a second effect
export const Idempotent = () => UseInterceptors(IdempotencyInterceptor);
