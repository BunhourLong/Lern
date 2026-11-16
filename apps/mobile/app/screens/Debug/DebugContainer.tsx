import { useState } from 'react';
import { useStore } from 'zustand';
import type { Core } from '../../boot/core';
import DebugScreen from './DebugScreen';

type Props = {
  core: Pick<Core, 'stores' | 'api' | 'signIn' | 'signOut' | 'setOnline'>;
};

export default function DebugContainer({ core }: Props) {
  const { session, activeRide, driverMode, rawEvents } = core.stores;
  const state = {
    session: useStore(session),
    activeRide: useStore(activeRide),
    driverMode: useStore(driverMode),
  };
  const raw = useStore(rawEvents);
  const [phone, setPhone] = useState('+85512345678');
  const [code, setCode] = useState('000000'); // the dev OTP

  // A failed command shows on the screen instead of an unhandled rejection
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      raw.add('error', String(err));
    }
  };

  return (
    <DebugScreen
      state={state}
      events={raw.events}
      phone={phone}
      code={code}
      onPhone={setPhone}
      onCode={setCode}
      onSendCode={() => run(() => core.api.requestOtp(phone))}
      onVerify={() => run(() => core.signIn(phone, code))}
      onSignOut={() => run(() => core.signOut())}
      onOnline={() => run(() => core.setOnline(true))}
      onOffline={() => run(() => core.setOnline(false))}
    />
  );
}
