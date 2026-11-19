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
  prefix,
  accessibilityHint,
  ...props
}: Omit<TextInputProps, 'style'> & {
  label: string;
  error?: string;
  prefix?: string;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const input = (
    <TextInput
      {...props}
      accessibilityLabel={label}
      accessibilityHint={error || accessibilityHint}
      placeholderTextColor={colors.textMuted}
      style={[styles.input, !!error && styles.invalid, !!prefix && styles.grow]}
    />
  );

  return (
    <View style={styles.field}>
      <Text
        role="bodyStrong"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {label}
      </Text>
      {prefix ? (
        <View style={styles.inputRow}>
          <Text role="bodyStrong">{prefix}</Text>
          {input}
        </View>
      ) : (
        input
      )}
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
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
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
