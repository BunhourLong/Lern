import type { AppGate } from '../stores/app-config.store';
import type { SessionState } from '../stores/session.store';

export type RootRoute =
  | 'loading'
  | 'maintenance'
  | 'update'
  | 'login'
  | 'driver'
  | 'rider';

export function rootRoute(
  session: Pick<SessionState, 'status' | 'me'>,
  gate: AppGate | null,
): RootRoute {
  if (gate === null || session.status === 'restoring') return 'loading';
  if (gate.status === 'maintenance') return 'maintenance';
  if (gate.status === 'update_required') return 'update';
  if (session.status === 'signed_out') return 'login';
  return session.me?.roles.includes('driver') ? 'driver' : 'rider';
}
