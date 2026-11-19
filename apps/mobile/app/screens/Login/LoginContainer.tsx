import { phoneSchema } from '@lern/contracts';
import { useRef, useState } from 'react';
import { useCountdown } from '../../hooks/use-countdown';
import { useT } from '../../i18n';
import type { StringKey } from '../../i18n';
import { otpRequestError, otpRetryAt } from '../../services/otp-error';
import LoginScreen from './LoginScreen';
import { normalizePhone } from './normalize-phone';

type Props = {
  requestOtp(phone: string): Promise<void>;
  onSent(params: { phone: string; sentAt: number }): void;
  onDebug?: () => void;
  now?: () => number;
};

export default function LoginContainer({
  requestOtp,
  onSent,
  onDebug,
  now = Date.now,
}: Props) {
  const t = useT();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<StringKey>();
  const [retryAt, setRetryAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const seconds = useCountdown(retryAt, now);

  async function send() {
    if (sending.current) return;
    const parsed = phoneSchema.safeParse(normalizePhone(phone));
    if (!parsed.success) {
      setError('login.invalidPhone');
      return;
    }
    sending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await requestOtp(parsed.data);
      onSent({ phone: parsed.data, sentAt: now() });
    } catch (err) {
      const deadline = otpRetryAt(err, now);
      if (deadline !== undefined) setRetryAt(deadline);
      else setError(otpRequestError(err));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <LoginScreen
      phone={phone}
      phoneLabel={t('login.phone')}
      prefix={t('login.prefix')}
      sendLabel={t('login.send')}
      error={
        seconds > 0
          ? t('auth.throttled', { time: t('auth.seconds', { seconds }) })
          : error && t(error)
      }
      busy={busy}
      blocked={seconds > 0}
      onChangePhone={value => {
        setPhone(value);
        setError(undefined);
      }}
      onSend={() => {
        send();
      }}
      debug={onDebug && { label: t('route.debug'), onPress: onDebug }}
    />
  );
}
