import { View } from 'react-native';
import { makeStyles, spacing } from '@theme';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';

type Props = {
  instructions: string;
  code: string;
  codeLabel: string;
  verifyLabel: string;
  resendLabel: string;
  verifyError?: string;
  resendError?: string;
  verifying: boolean;
  resending: boolean;
  verifyDisabled: boolean;
  resendDisabled: boolean;
  onChangeCode(value: string): void;
  onVerify(): void;
  onResend(): void;
};

export default function OtpScreen({
  instructions,
  code,
  codeLabel,
  verifyLabel,
  resendLabel,
  verifyError,
  resendError,
  verifying,
  resending,
  verifyDisabled,
  resendDisabled,
  onChangeCode,
  onVerify,
  onResend,
}: Props) {
  const styles = useStyles();
  return (
    <Screen scroll edges={['left', 'right', 'bottom']}>
      <View style={styles.form}>
        <Text>{instructions}</Text>
        <TextField
          label={codeLabel}
          value={code}
          error={verifyError}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          maxLength={6}
          editable={!verifying && !resending}
          onChangeText={onChangeCode}
        />
        <Button
          label={verifyLabel}
          onPress={onVerify}
          loading={verifying}
          disabled={verifyDisabled}
        />
        <Button
          label={resendLabel}
          onPress={onResend}
          variant="secondary"
          loading={resending}
          disabled={resendDisabled}
        />
        {resendError && (
          <Text tone="danger" accessibilityLiveRegion="polite">
            {resendError}
          </Text>
        )}
      </View>
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  form: { gap: spacing.md },
}));
