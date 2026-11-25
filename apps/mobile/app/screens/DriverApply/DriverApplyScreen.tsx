import type { VehicleType } from '@lern/contracts';
import { Platform, Pressable, View } from 'react-native';
import {
  makeStyles,
  opacity,
  outlineWidth,
  radius,
  spacing,
  touch,
} from '@theme';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { useInteraction } from '../../hooks/use-interaction';

type Props = {
  vehicleType?: VehicleType;
  vehicleLabel: string;
  vehicles: { value: VehicleType; label: string; hint: string }[];
  vehicleError?: string;
  plate: string;
  plateLabel: string;
  plateError?: string;
  nextSteps: string;
  submitLabel: string;
  submitError?: string;
  busy: boolean;
  onVehicleChange(value: VehicleType): void;
  onPlateChange(value: string): void;
  onSubmit(): void;
};

export default function DriverApplyScreen({
  vehicleType,
  vehicleLabel,
  vehicles,
  vehicleError,
  plate,
  plateLabel,
  plateError,
  nextSteps,
  submitLabel,
  submitError,
  busy,
  onVehicleChange,
  onPlateChange,
  onSubmit,
}: Props) {
  const styles = useStyles();
  const interact = useInteraction();
  return (
    <Screen scroll edges={['left', 'right', 'bottom']}>
      <View style={styles.form}>
        <View
          // VoiceOver needs the individual radios to remain focusable.
          accessible={Platform.OS === 'android'}
          accessibilityRole="radiogroup"
          accessibilityLabel={vehicleLabel}
          style={styles.vehicles}
        >
          <Text
            role="bodyStrong"
            accessibilityRole="header"
            importantForAccessibility="no"
          >
            {vehicleLabel}
          </Text>
          {vehicles.map(({ value, label, hint }) => {
            const checked = vehicleType === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityLabel={label}
                accessibilityHint={hint}
                accessibilityState={{ checked, disabled: busy }}
                disabled={busy}
                onPress={() => {
                  if (interact()) onVehicleChange(value);
                }}
                style={({ pressed }) => [
                  styles.vehicle,
                  checked && styles.checked,
                  pressed && styles.pressed,
                ]}
              >
                <Text role="bodyStrong" tone={checked ? 'primary' : 'default'}>
                  {label}
                </Text>
                <Text role="caption" tone="muted">
                  {hint}
                </Text>
              </Pressable>
            );
          })}
          {vehicleError && (
            <Text tone="danger" accessibilityLiveRegion="polite">
              {vehicleError}
            </Text>
          )}
        </View>
        <TextField
          label={plateLabel}
          value={plate}
          error={plateError}
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!busy}
          accessibilityState={{ disabled: busy }}
          onChangeText={onPlateChange}
        />
        <Text tone="muted">{nextSteps}</Text>
        <Button label={submitLabel} onPress={onSubmit} loading={busy} />
        {submitError && (
          <Text tone="danger" accessibilityLiveRegion="polite">
            {submitError}
          </Text>
        )}
      </View>
    </Screen>
  );
}

const useStyles = makeStyles(t => ({
  form: { gap: spacing.md },
  vehicles: { gap: spacing.sm },
  vehicle: {
    backgroundColor: t.colors.surface,
    borderColor: t.colors.border,
    borderWidth: outlineWidth,
    borderRadius: radius.md,
    minHeight: touch.min,
    minWidth: touch.min,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  checked: { borderColor: t.colors.primary },
  pressed: { opacity: opacity.pressed },
}));
