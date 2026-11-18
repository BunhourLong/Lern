import { Pressable, StyleSheet, Text as NativeText, View } from 'react-native';
import { makeStyles, opacity, spacing, touch, type } from '@theme';
import { Text } from './Text';

export function ListRow({
  title,
  subtitle,
  value,
  onPress,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  onPress?(): void;
}) {
  const styles = useStyles();
  const content = (
    <>
      <View style={styles.details}>
        <Text role="bodyStrong">{title}</Text>
        {subtitle ? (
          <Text role="caption" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? <NativeText style={styles.value}>{value}</NativeText> : null}
    </>
  );

  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, subtitle, value].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  ) : (
    <View accessible style={styles.row}>
      {content}
    </View>
  );
}

const useStyles = makeStyles(t => ({
  row: {
    minHeight: touch.min,
    minWidth: touch.min,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.border,
  },
  pressed: { opacity: opacity.pressed },
  details: { flex: 1, gap: spacing.xs },
  value: { ...type.body, color: t.colors.textMuted, flexShrink: 1 },
}));
