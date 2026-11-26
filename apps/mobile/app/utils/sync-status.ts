export function syncStatus({
  network,
  signedIn,
  socketConnected,
}: {
  network: boolean | null;
  signedIn: boolean;
  socketConnected: boolean;
}): 'offline' | 'reconnecting' | 'ok' {
  if (network === false) return 'offline';
  if (signedIn && !socketConnected) return 'reconnecting';
  return 'ok';
}
