import { verifyOtpSchema } from '@lern/contracts';
import { useRef, useState } from 'react';
import { useCountdown } from '../../../hooks/use-countdown';
import { ApiError } from '../../../services/api.service';
import { otpRequestError, otpRetryAt } from '../../../services/otp-error';

// Match the server's rl:otp:resend limit.
const RESEND_MS = 60_000;
const codeSchema = verifyOtpSchema.shape.code;

export type OtpOptions = {
  phone: string;
  sentAt: number;
  signIn(phone: string, code: string): Promise<void>;
  requestOtp(phone: string): Promise<void>;
  now?: () => number;
};

type RequestError = ReturnType<typeof otpRequestError>;

export function useOtp({
  phone,
  sentAt,
  signIn,
  requestOtp,
  now = Date.now,
}: OtpOptions) {
  const [code, setCode] = useState('');
  const [action, setAction] = useState<'verify' | 'resend'>();
  const [verifyError, setVerifyError] = useState<
    RequestError | 'otp.wrongCode'
  >();
  const [resendError, setResendError] = useState<
    RequestError | 'auth.throttled'
  >();
  const [verifyAt, setVerifyAt] = useState(0);
  const [resendAt, setResendAt] = useState(sentAt + RESEND_MS);
  const verifySeconds = useCountdown(verifyAt, now);
  const resendSeconds = useCountdown(resendAt, now);
  const pending = useRef(false);
  const accepted = useRef(false);
  const verifyDeadline = useRef(0);

  async function verify(value: string) {
    if (
      pending.current ||
      accepted.current ||
      now() < verifyDeadline.current ||
      !codeSchema.safeParse(value).success
    )
      return;
    pending.current = true;
    setAction('verify');
    setVerifyError(undefined);
    try {
      await signIn(phone, value);
      accepted.current = true;
    } catch (err) {
      const deadline = otpRetryAt(err, now);
      if (deadline !== undefined) {
        verifyDeadline.current = deadline;
        setVerifyAt(deadline);
      } else {
        setVerifyError(
          err instanceof ApiError && err.status === 401
            ? 'otp.wrongCode'
            : otpRequestError(err),
        );
      }
    } finally {
      pending.current = false;
      setAction(undefined);
    }
  }

  async function resend() {
    if (pending.current) return;
    pending.current = true;
    setAction('resend');
    setResendError(undefined);
    try {
      await requestOtp(phone);
      setResendAt(now() + RESEND_MS);
    } catch (err) {
      const deadline = otpRetryAt(err, now);
      if (deadline !== undefined) {
        setResendAt(deadline);
        setResendError('auth.throttled');
      } else setResendError(otpRequestError(err));
    } finally {
      pending.current = false;
      setAction(undefined);
    }
  }

  return {
    code,
    verifyError,
    resendError,
    verifySeconds,
    resendSeconds,
    verifying: action === 'verify',
    resending: action === 'resend',
    verifyDisabled:
      !!action || verifySeconds > 0 || !codeSchema.safeParse(code).success,
    resendDisabled: !!action || resendSeconds > 0,
    changeCode(value: string) {
      setCode(value);
      setVerifyError(undefined);
      verify(value);
    },
    verify: () => {
      verify(code);
    },
    resend: () => {
      resend();
    },
  };
}
