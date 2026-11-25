import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { Core } from '../boot/core';
import { useT } from '../i18n';
import { syncStatus } from '../utils/sync-status';
import { SyncStatusToast, type ToastStatus } from './SyncStatusToast';

type Props = Pick<Core['stores'], 'connection' | 'session'>;

export function SyncStatusToastContainer({ connection, session }: Props) {
  const network = useStore(connection, state => state.network);
  const socketConnected = useStore(connection, state => state.connected);
  const signedIn = useStore(session, state => state.status === 'signed_in');
  const current = syncStatus({ network, signedIn, socketConnected });
  const t = useT();
  const [shown, setShown] = useState<ToastStatus | null>(null);
  const warningVisible = shown === 'offline' || shown === 'reconnecting';
  const recoveryStatus =
    shown === 'reconnecting' && !socketConnected ? null : 'connected';

  useEffect(() => {
    if (warningVisible) {
      setShown(current === 'ok' ? recoveryStatus : current);
    } else if (current !== 'ok') {
      const timer = setTimeout(() => setShown(current), 1000);
      return () => clearTimeout(timer);
    }
  }, [current, recoveryStatus, warningVisible]);

  useEffect(() => {
    if (shown !== 'connected') return;
    const timer = setTimeout(() => setShown(null), 2000);
    return () => clearTimeout(timer);
  }, [shown]);

  return (
    <SyncStatusToast status={shown} label={shown ? t(`sync.${shown}`) : ''} />
  );
}
