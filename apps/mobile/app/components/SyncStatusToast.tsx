import { useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Platform,
  Text,
  useAnimatedValue,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles, radius, spacing, syncStatusMaxWidth, type } from '@theme';

export type ToastStatus = 'offline' | 'reconnecting' | 'connected';

type PillProps = { status: ToastStatus; label: string };

export function SyncStatusPill({ status, label }: PillProps) {
  const styles = useStyles();
  const [fill, setFill] = useState({
    status,
    previous: null as ToastStatus | null,
  });
  if (fill.status !== status) setFill({ status, previous: fill.status });

  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={label}
      pointerEvents="none"
      style={[styles.pill, styles[status]]}
    >
      {fill.previous && <FadingFill key={status} status={fill.previous} />}
      {/* The largest-text screenshot showed this status overlay covering Home content. The status is also announced. */}
      <Text style={styles.label} maxFontSizeMultiplier={1.5}>
        {label}
      </Text>
    </View>
  );
}

function FadingFill({ status }: Pick<PillProps, 'status'>) {
  const styles = useStyles();
  const opacity = useAnimatedValue(1);
  useEffect(() => {
    const fade = Animated.timing(opacity, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    });
    fade.start();
    return () => fade.stop();
  }, [opacity]);
  const fadeStyle = { opacity };
  return <Animated.View style={[styles.fill, styles[status], fadeStyle]} />;
}

export function SyncStatusToast({
  status,
  label,
}: {
  status: ToastStatus | null;
  label: string;
}) {
  const styles = useStyles();
  const { top } = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const progress = useAnimatedValue(0);
  const pulseProgress = useAnimatedValue(0);
  const scale = useMemo(
    () =>
      pulseProgress.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [1, 0.98, 1],
      }),
    [pulseProgress],
  );
  // A percentage keeps the whole pill above the clip edge even when its label wraps.
  const translateY = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: ['-100%', '0%'],
      }),
    [progress],
  );
  const [last, setLast] = useState<PillProps | null>(null);
  if (status && (last?.status !== status || last.label !== label)) {
    setLast({ status, label });
  }
  const mounted = last !== null;
  const visible = status !== null;
  const pulsing =
    (status === 'offline' || status === 'reconnecting') && !reduceMotion;

  useEffect(() => {
    if (status && Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(label);
    }
  }, [status, label]);

  useEffect(() => {
    if (!mounted) return;
    const animation =
      visible && !reduceMotion
        ? Animated.spring(progress, { toValue: 1, useNativeDriver: false })
        : Animated.timing(progress, {
            toValue: visible ? 1 : 0,
            duration: 200,
            useNativeDriver: false,
          });
    animation.start(({ finished }) => {
      if (finished && !visible) setLast(null);
    });
    return () => animation.stop();
  }, [mounted, visible, reduceMotion, progress]);

  useEffect(() => {
    if (!pulsing) return;
    const pulse = Animated.loop(
      Animated.timing(pulseProgress, {
        toValue: 1,
        duration: 1500,
        isInteraction: false,
        useNativeDriver: true,
      }),
    );
    pulse.start();
    return () => {
      pulse.stop();
      pulseProgress.setValue(0);
    };
  }, [pulsing, pulseProgress]);

  if (!last) return null;
  const safeArea = { top };
  const motion = reduceMotion
    ? { opacity: progress }
    : { transform: [{ translateY }] };
  const pulseMotion = { transform: [{ scale }] };
  return (
    <View
      testID="sync-status-overlay"
      pointerEvents="none"
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      style={[styles.overlay, safeArea]}
    >
      <Animated.View style={[styles.position, motion]}>
        <Animated.View style={[styles.pulse, pulseMotion]}>
          <SyncStatusPill {...last} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

function useReduceMotion() {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    let useInitialRead = true;
    AccessibilityInfo.isReduceMotionEnabled().then(
      value => {
        if (useInitialRead) setEnabled(value);
      },
      () => {},
    );
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      value => {
        useInitialRead = false;
        setEnabled(value);
      },
    );
    return () => {
      useInitialRead = false;
      subscription.remove();
    };
  }, []);
  return enabled;
}

const useStyles = makeStyles(t => ({
  overlay: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    alignItems: 'center',
    overflow: 'hidden',
    zIndex: 1,
  },
  position: {
    maxWidth: syncStatusMaxWidth,
    width: '100%',
    alignItems: 'center',
    paddingTop: spacing.sm,
  },
  pulse: { alignSelf: 'stretch' },
  pill: {
    alignSelf: 'center',
    maxWidth: '100%',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  fill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: radius.pill,
  },
  offline: { backgroundColor: t.colors.danger },
  reconnecting: { backgroundColor: t.colors.warning },
  connected: { backgroundColor: t.colors.success },
  label: { ...type.bodyStrong, color: t.colors.onStatus, textAlign: 'center' },
}));
