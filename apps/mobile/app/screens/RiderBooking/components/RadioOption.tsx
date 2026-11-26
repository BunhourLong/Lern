import { Pressable, View } from 'react-native';
import {
  makeStyles,
  mapPinBorderWidth,
  opacity,
  outlineWidth,
  radius,
  spacing,
  touch,
} from '@theme';
import { Text } from '../../../components/Text';
import { useInteraction } from '../../../hooks/use-interaction';

export function RadioOption({
  label,
  hint,
  valueText,
  checked,
  disabled,
  onPress,
}: {
  label: string;
  hint?: string;
  valueText?: string;
  checked: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const interact = useInteraction();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityValue={valueText ? { text: valueText } : undefined}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => {
        if (interact()) onPress();
      }}
      style={({ pressed }) => [
        styles.option,
        checked && styles.checked,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.optionHeader}>
        <View style={styles.optionLabel}>
          <Text role="bodyStrong" tone={checked ? 'primary' : 'default'}>
            {label}
          </Text>
        </View>
        {checked && (
          <Text
            role="bodyStrong"
            tone="primary"
            accessible={false}
            importantForAccessibility="no"
          >
            ✓
          </Text>
        )}
      </View>
      {(valueText ?? hint) && (
        <Text role="caption" tone="muted">
          {valueText ?? hint}
        </Text>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles(t => ({
  option: {
    backgroundColor: t.colors.surface,
    borderColor: t.colors.border,
    borderWidth: outlineWidth,
    borderRadius: radius.md,
    minHeight: touch.min,
    minWidth: touch.min,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  optionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  optionLabel: { flexShrink: 1 },
  checked: { borderColor: t.colors.primary, borderWidth: mapPinBorderWidth },
  disabled: { opacity: opacity.disabled },
  pressed: { opacity: opacity.pressed },
}));
