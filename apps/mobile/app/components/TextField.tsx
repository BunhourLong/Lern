import { TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';
import {
  makeStyles,
  outlineWidth,
  radius,
  spacing,
  touch,
  type,
  useTheme,
} from '@theme';
import { Text } from './Text';

export function TextField({
  label,
  error,
  accessibilityHint,
  ...props
}: Omit<TextInputProps, 'style'> & { label: string; error?: string }) {
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.field}>
      <Text
        role="bodyStrong"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {label}
      </Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        accessibilityHint={error || accessibilityHint}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, !!error && styles.invalid]}
      />
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(t => ({
  field: { gap: spacing.xs },
  input: {
    ...type.body,
    color: t.colors.text,
    backgroundColor: t.colors.surface,
    borderColor: t.colors.border,
    borderWidth: outlineWidth,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: touch.min,
    minWidth: touch.min,
  },
  invalid: { borderColor: t.colors.danger },
}));
