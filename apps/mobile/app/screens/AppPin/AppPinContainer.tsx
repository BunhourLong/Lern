import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { Core } from '../../boot/core';
import { useT, type StringKey } from '../../i18n';
import { AppPinScreen, type PinMode } from './AppPinScreen';

export type PinActions = Pick<
  Core,
  'enableLock' | 'unlock' | 'interruptPinCheck' | 'pinWaitMs' | 'signOut'
>;

export function AppPinContainer({
  core,
  mode,
  onSuccess,
  onCancel,
}: {
  core: PinActions;
  mode: PinMode;
  onSuccess?(): void;
  onCancel?(): void;
}) {
  const t = useT();
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<StringKey>();
  const [busy, setBusy] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [wait, setWait] = useState(core.pinWaitMs);
  const pending = useRef(false);
  const leaving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') setWait(core.pinWaitMs());
      else {
        core.interruptPinCheck();
        setPin('');
        setConfirmation('');
      }
    });
    return () => {
      mounted.current = false;
      core.interruptPinCheck();
      listener.remove();
    };
  }, [core]);
  const waiting = wait > 0;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setWait(core.pinWaitMs()), 1000);
    return () => clearInterval(timer);
  }, [core, waiting]);

  async function submit() {
    if (pending.current || leaving.current || waiting) return;
    if (mode === 'enroll' && pin !== confirmation) {
      setError('pin.mismatch');
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      if (mode === 'enroll') await core.enableLock(pin);
      else {
        const result = await core.unlock(pin);
        if (!result.ok) {
          if (mounted.current && 'waitMs' in result) {
            setPin('');
            setWait(core.pinWaitMs());
            setError('pin.incorrect');
          }
          return;
        }
      }
      if (mounted.current && !leaving.current) onSuccess?.();
    } catch {
      if (mounted.current) setError('auth.error');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function exit() {
    if (leaving.current) return;
    leaving.current = true;
    core.interruptPinCheck();
    if (mode !== 'unlock') {
      onCancel?.();
      return;
    }
    setExiting(true);
    try {
      await core.signOut();
    } catch {
      if (mounted.current) setError('auth.error');
    } finally {
      leaving.current = false;
      if (mounted.current) setExiting(false);
    }
  }

  return (
    <AppPinScreen
      mode={mode}
      pin={pin}
      confirmation={confirmation}
      error={
        waiting
          ? t('auth.throttled', {
              time: t('auth.seconds', { seconds: Math.ceil(wait / 1000) }),
            })
          : error && t(error)
      }
      busy={busy}
      exiting={exiting}
      waiting={waiting}
      onPin={setPin}
      onConfirmation={setConfirmation}
      onSubmit={submit}
      onExit={exit}
    />
  );
}
