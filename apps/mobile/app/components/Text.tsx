import { Text as NativeText } from 'react-native';
import type { TextProps } from 'react-native';
import { makeStyles, type } from '@theme';

export function Text({
  role = 'body',
  tone = 'default',
  accessibilityRole,
  ...props
}: Omit<TextProps, 'style' | 'role'> & {
  role?: keyof typeof type;
  tone?: 'default' | 'muted' | 'danger';
}) {
  const styles = useStyles();
  return (
    <NativeText
      {...props}
      accessibilityRole={role === 'title' ? 'header' : accessibilityRole}
      style={[styles[role], styles[tone]]}
    />
  );
}

const useStyles = makeStyles(t => ({
  ...type,
  default: { color: t.colors.text },
  muted: { color: t.colors.textMuted },
  danger: { color: t.colors.danger },
}));
