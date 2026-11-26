import { useState } from 'react';
import { useStore } from 'zustand';
import type { Core } from '../../boot/core';
import { useInteraction } from '../../hooks/use-interaction';
import { useT } from '../../i18n';
import DebugScreen from './DebugScreen';

type Props = {
  core: Pick<Core, 'stores' | 'api' | 'signIn' | 'signOut' | 'setOnline'>;
};

export default function DebugContainer({ core }: Props) {
  const { session, activeRide, driverMode, rawEvents, language } = core.stores;
  const state = {
    session: useStore(session),
    activeRide: useStore(activeRide),
    driverMode: useStore(driverMode),
  };
  const raw = useStore(rawEvents);
  const preference = useStore(language);
  const t = useT();
  const interact = useInteraction();
  const [phone, setPhone] = useState('+85512345678');
  const [code, setCode] = useState('000000'); // the dev OTP

  // A failed command shows on the screen instead of an unhandled rejection
  const run = async (fn: () => Promise<unknown>) => {
    if (!interact()) return;
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
      language={{
        phone: t('debug.language.phone'),
        en: t('debug.language.en'),
        km: t('debug.language.km'),
        sample: `${t('common.retry')} · ${preference.language}`,
        override: preference.override,
        setOverride: next => {
          if (interact()) preference.setOverride(next);
        },
      }}
      phone={phone}
      code={code}
      onPhone={next => {
        if (interact()) setPhone(next);
      }}
      onCode={next => {
        if (interact()) setCode(next);
      }}
      onSendCode={() => run(() => core.api.requestOtp(phone))}
      onVerify={() => run(() => core.signIn(phone, code))}
      onSignOut={() => run(() => core.signOut())}
      onOnline={() => run(() => core.setOnline(true))}
      onOffline={() => run(() => core.setOnline(false))}
    />
  );
}
