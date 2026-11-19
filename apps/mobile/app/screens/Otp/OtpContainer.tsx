import { useT } from '../../i18n';
import { useOtp } from './hooks/use-otp';
import type { OtpOptions } from './hooks/use-otp';
import OtpScreen from './OtpScreen';

export default function OtpContainer(props: OtpOptions) {
  const t = useT();
  const otp = useOtp(props);
  const time = (seconds: number) => t('auth.seconds', { seconds });

  return (
    <OtpScreen
      instructions={t('otp.instructions', { phone: props.phone })}
      code={otp.code}
      codeLabel={t('otp.code')}
      verifyLabel={t('otp.verify')}
      resendLabel={
        otp.resendSeconds > 0
          ? t('otp.resendIn', { time: time(otp.resendSeconds) })
          : t('otp.resend')
      }
      verifyError={
        otp.verifySeconds > 0
          ? t('auth.throttled', { time: time(otp.verifySeconds) })
          : otp.verifyError && t(otp.verifyError)
      }
      resendError={
        otp.resendError === 'auth.throttled'
          ? otp.resendSeconds > 0
            ? t('auth.throttled', { time: time(otp.resendSeconds) })
            : undefined
          : otp.resendError && t(otp.resendError)
      }
      verifying={otp.verifying}
      resending={otp.resending}
      verifyDisabled={otp.verifyDisabled}
      resendDisabled={otp.resendDisabled}
      onChangeCode={otp.changeCode}
      onVerify={otp.verify}
      onResend={otp.resend}
    />
  );
}
