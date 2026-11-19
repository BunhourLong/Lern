import { View } from 'react-native';
import { makeStyles, spacing } from '@theme';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';

type Props = {
  phone: string;
  phoneLabel: string;
  prefix: string;
  sendLabel: string;
  error?: string;
  busy: boolean;
  blocked: boolean;
  onChangePhone(value: string): void;
  onSend(): void;
  debug?: { label: string; onPress(): void };
};

export default function LoginScreen({
  phone,
  phoneLabel,
  prefix,
  sendLabel,
  error,
  busy,
  blocked,
  onChangePhone,
  onSend,
  debug,
}: Props) {
  const styles = useStyles();
  return (
    <Screen scroll edges={['left', 'right', 'bottom']}>
      <View style={styles.form}>
        <TextField
          label={phoneLabel}
          prefix={prefix}
          value={phone}
          error={error}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          editable={!busy}
          onChangeText={onChangePhone}
        />
        <Button
          label={sendLabel}
          onPress={onSend}
          loading={busy}
          disabled={blocked}
        />
        {debug && (
          <Button
            label={debug.label}
            onPress={debug.onPress}
            variant="secondary"
          />
        )}
      </View>
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  form: { gap: spacing.md },
}));
