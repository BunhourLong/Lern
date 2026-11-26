import { useEffect } from 'react';
import { AccessibilityInfo, Platform, View } from 'react-native';
import { bannerEdgeWidth, makeStyles, spacing } from '@theme';
import { Text } from './Text';

export function Banner({
  message,
  tone = 'info',
  announce = true,
}: {
  message: string;
  tone?: 'info' | 'warning' | 'danger';
  announce?: boolean;
}) {
  const styles = useStyles();
  useEffect(() => {
    if (announce && Platform.OS === 'ios')
      AccessibilityInfo.announceForAccessibility(message);
  }, [announce, message]);

  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.banner, styles[tone]]}
    >
      <Text>{message}</Text>
    </View>
  );
}

const useStyles = makeStyles(t => ({
  banner: {
    backgroundColor: t.colors.surface,
    borderLeftWidth: bannerEdgeWidth,
    padding: spacing.md,
  },
  info: { borderLeftColor: t.colors.primary },
  warning: { borderLeftColor: t.colors.warning },
  danger: { borderLeftColor: t.colors.danger },
}));
