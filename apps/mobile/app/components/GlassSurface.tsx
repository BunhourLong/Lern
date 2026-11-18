import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Platform, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import { makeStyles, radius, spacing } from '@theme';

export function GlassSurface({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  const reduce = useReduceTransparency();
  if (
    !reduce &&
    Platform.OS === 'ios' &&
    isLiquidGlassAvailable() &&
    isGlassEffectAPIAvailable()
  ) {
    return <GlassView style={[styles.card, style]}>{children}</GlassView>;
  }
  return (
    <View style={[styles.card, reduce ? styles.solid : styles.glass, style]}>
      {children}
    </View>
  );
}

function useReduceTransparency() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let useInitialRead = true;
    AccessibilityInfo.isReduceTransparencyEnabled().then(
      enabled => {
        if (useInitialRead) setReduce(enabled);
      },
      () => {},
    );
    const subscription = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      enabled => {
        useInitialRead = false;
        setReduce(enabled);
      },
    );
    return () => {
      useInitialRead = false;
      subscription.remove();
    };
  }, []);
  return reduce;
}

const useStyles = makeStyles(t => ({
  card: { borderRadius: radius.lg, padding: spacing.lg },
  glass: { backgroundColor: t.colors.surfaceGlass },
  solid: { backgroundColor: t.colors.surface },
}));
