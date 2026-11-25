import { View } from 'react-native';
import { makeStyles, spacing } from '@theme';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { useT } from '../../i18n';

export type PinMode = 'unlock' | 'enroll' | 'confirm';

type Props = {
  mode: PinMode;
  pin: string;
  confirmation: string;
  error?: string;
  busy: boolean;
  exiting: boolean;
  waiting: boolean;
  onPin(value: string): void;
  onConfirmation(value: string): void;
  onSubmit(): void;
  onExit(): void;
};

export function AppPinScreen(p: Props) {
  const t = useT();
  const s = useStyles();
  const enroll = p.mode === 'enroll';
  const canSubmit =
    /^\d{6}$/.test(p.pin) && (!enroll || /^\d{6}$/.test(p.confirmation));
  return (
    <Screen scroll>
      <View style={s.form}>
        <Text role="title">{t(`pin.title.${p.mode}`)}</Text>
        <TextField
          label={t('pin.label')}
          value={p.pin}
          onChangeText={p.onPin}
          secureTextEntry
          keyboardType="number-pad"
          autoComplete="off"
          maxLength={6}
          editable={!p.busy && !p.waiting}
        />
        {enroll && (
          <TextField
            label={t('pin.confirmation')}
            value={p.confirmation}
            onChangeText={p.onConfirmation}
            secureTextEntry
            keyboardType="number-pad"
            autoComplete="off"
            maxLength={6}
            editable={!p.busy}
          />
        )}
        {p.error && (
          <Text tone="danger" accessibilityLiveRegion="polite">
            {p.error}
          </Text>
        )}
        <Button
          label={t(`pin.submit.${p.mode}`)}
          onPress={p.onSubmit}
          disabled={!canSubmit || p.waiting || p.exiting}
          loading={p.busy}
        />
        <Button
          label={t(p.mode === 'unlock' ? 'pin.signOut' : 'pin.cancel')}
          variant="secondary"
          loading={p.exiting}
          onPress={p.onExit}
        />
      </View>
    </Screen>
  );
}

const useStyles = makeStyles(() => ({ form: { gap: spacing.md } }));
