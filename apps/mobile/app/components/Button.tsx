import { ActivityIndicator, Pressable, Text } from 'react-native';
import {
  makeStyles,
  opacity,
  outlineWidth,
  radius,
  spacing,
  touch,
  type,
} from '@theme';

import { useInteraction } from '../hooks/use-interaction';

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
}: {
  label: string;
  onPress(): void;
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
}) {
  const interact = useInteraction();
  const styles = useStyles();
  const blocked = disabled || loading;
  const labelStyle =
    variant === 'primary' ? styles.onPrimary : styles.onNeutral;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={() => {
        if (interact()) onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        blocked && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator animating color={labelStyle.color} />
      ) : null}
      <Text style={[styles.label, labelStyle]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles(t => ({
  button: {
    minHeight: touch.min,
    minWidth: touch.min,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  primary: { backgroundColor: t.colors.primary },
  secondary: { borderWidth: outlineWidth, borderColor: t.colors.border },
  pressed: { opacity: opacity.pressed },
  disabled: { opacity: opacity.disabled },
  label: { ...type.button, flexShrink: 1, textAlign: 'center' },
  onPrimary: { color: t.colors.onPrimary },
  onNeutral: { color: t.colors.primary },
}));
