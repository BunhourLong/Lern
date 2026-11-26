import type { Point, Ride } from '@lern/contracts';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform, Pressable, View } from 'react-native';
import {
  makeStyles,
  opacity,
  progressBarHeight,
  radius,
  spacing,
  touch,
} from '@theme';
import { AppMap, type MapPin } from '../../../components/AppMap';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { GlassSurface } from '../../../components/GlassSurface';
import { Text } from '../../../components/Text';
import { useInteraction } from '../../../hooks/use-interaction';
import type { RiderCancelReason, RiderProgressStep } from '../rider-ride';
import { RadioOption } from './RadioOption';

type Progress = {
  steps: readonly { key: RiderProgressStep; label: string }[];
  currentIndex: number;
  completed?: boolean;
  accessibilityLabel: string;
};

export function RideProgressBar({
  steps,
  currentIndex,
  completed,
  accessibilityLabel,
}: Progress) {
  const styles = useStyles();
  return (
    <View style={styles.summary}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{
          min: 1,
          max: steps.length,
          now: currentIndex + 1,
          text: accessibilityLabel,
        }}
        style={styles.track}
      >
        {steps.map(({ key }, index) => (
          <View
            key={key}
            style={[
              styles.segment,
              index <= currentIndex && styles.activeSegment,
            ]}
          />
        ))}
      </View>
      <View
        style={styles.stages}
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {steps.map(({ key, label }, index) => {
          const done = completed || index < currentIndex;
          const current = !completed && index === currentIndex;
          return (
            <Text
              key={key}
              role={current ? 'bodyStrong' : 'caption'}
              tone={done || current ? 'primary' : 'muted'}
            >
              {done ? `✓ ${label}` : label}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

export function useRideStatusAnnouncement(
  id: string | undefined,
  status: Ride['status'] | undefined,
  statusTitle: string | undefined,
  announce = true,
) {
  const previous = useRef<{ id?: string; status?: Ride['status'] }>(undefined);
  useEffect(() => {
    if (
      announce &&
      Platform.OS === 'ios' &&
      statusTitle &&
      previous.current?.id === id &&
      previous.current?.status !== status
    )
      AccessibilityInfo.announceForAccessibility(statusTitle);
    previous.current = { id, status };
  }, [announce, id, status, statusTitle]);
}

export type CancelPicker = {
  open: boolean;
  openLabel: string;
  prompt: string;
  reasons: readonly { value: RiderCancelReason; label: string }[];
  selected?: RiderCancelReason;
  confirmLabel: string;
  keepLabel: string;
  disabled: boolean;
  loading: boolean;
  error?: string;
  onOpen: () => void;
  onSelect: (value: RiderCancelReason) => void;
  onConfirm: () => void;
  onKeep: () => void;
};

type Props = {
  statusTitle: string;
  progress?: Progress;
  pickupLabel: string;
  pickupSummary: string;
  dropoffLabel: string;
  dropoffSummary: string;
  fare: string;
  approxUsd?: string;
  vehicle: string;
} & (
  | {
      variant: 'active';
      staleNotice?: string;
      announceStale?: boolean;
      map: {
        center: Point;
        delta: number;
        pins: readonly MapPin[];
        label: string;
        unavailableLabel: string;
        hintLabel: string;
        onOpen?: () => void;
      };
      cancel?: CancelPicker;
    }
  | {
      variant: 'ended';
      note?: string;
      dismiss: { label: string; onPress: () => void };
    }
);

export function RiderRideCard(props: Props) {
  const styles = useStyles();
  const interact = useInteraction();
  const preview = props.variant === 'active' && (
    <AppMap
      size="active"
      interactive={false}
      center={props.map.center}
      delta={props.map.delta}
      pins={props.map.pins}
      accessibilityLabel={props.map.label}
      unavailableLabel={props.map.unavailableLabel}
    />
  );
  return (
    <GlassSurface style={styles.card}>
      <Text role="title" accessibilityLiveRegion="polite">
        {props.statusTitle}
      </Text>
      {props.progress && <RideProgressBar {...props.progress} />}
      {props.variant === 'active' ? (
        <>
          {props.staleNotice && (
            <Banner
              tone="warning"
              message={props.staleNotice}
              announce={props.announceStale}
            />
          )}
          {props.map.onOpen ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={props.map.label}
              accessibilityHint={props.map.hintLabel}
              accessibilityState={{ disabled: false }}
              onPress={() => {
                if (interact()) props.map.onOpen?.();
              }}
              style={({ pressed }) => [
                styles.mapButton,
                pressed && styles.pressed,
              ]}
            >
              {preview}
              <Text role="caption" tone="muted">
                {props.map.hintLabel}
              </Text>
            </Pressable>
          ) : (
            preview
          )}
        </>
      ) : (
        props.note && <Text tone="muted">{props.note}</Text>
      )}
      <View style={styles.summary}>
        <Text role="caption" tone="muted">
          {props.pickupLabel}
        </Text>
        <Text>{props.pickupSummary}</Text>
        <Text role="caption" tone="muted">
          {props.dropoffLabel}
        </Text>
        <Text>{props.dropoffSummary}</Text>
        <Text role="bodyStrong">{props.fare}</Text>
        {props.approxUsd && <Text tone="muted">{props.approxUsd}</Text>}
        <Text>{props.vehicle}</Text>
      </View>
      {props.variant === 'active' ? (
        props.cancel && <CancelRidePicker {...props.cancel} />
      ) : (
        <Button {...props.dismiss} />
      )}
    </GlassSurface>
  );
}

function CancelRidePicker(cancel: CancelPicker) {
  const styles = useStyles();
  if (!cancel.open)
    return (
      <Button
        variant="secondary"
        label={cancel.openLabel}
        onPress={cancel.onOpen}
        disabled={cancel.disabled}
      />
    );

  return (
    <>
      <View
        accessible={Platform.OS === 'android'}
        accessibilityRole="radiogroup"
        accessibilityLabel={cancel.prompt}
        style={styles.card}
      >
        <Text
          role="bodyStrong"
          accessibilityRole="header"
          importantForAccessibility="no"
        >
          {cancel.prompt}
        </Text>
        {cancel.reasons.map(({ value, label }) => (
          <RadioOption
            key={value}
            label={label}
            checked={cancel.selected === value}
            disabled={cancel.loading}
            onPress={() => cancel.onSelect(value)}
          />
        ))}
      </View>
      <Button
        label={cancel.confirmLabel}
        onPress={cancel.onConfirm}
        disabled={cancel.disabled || !cancel.selected}
        loading={cancel.loading}
      />
      <Button
        variant="secondary"
        label={cancel.keepLabel}
        onPress={cancel.onKeep}
        disabled={cancel.loading}
      />
      {cancel.error && (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {cancel.error}
        </Text>
      )}
    </>
  );
}

const useStyles = makeStyles(t => ({
  card: { gap: spacing.sm },
  summary: { gap: spacing.xs },
  track: { flexDirection: 'row', gap: spacing.xs },
  segment: {
    flex: 1,
    height: progressBarHeight,
    borderRadius: radius.pill,
    backgroundColor: t.colors.border,
  },
  activeSegment: { backgroundColor: t.colors.primary },
  stages: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  mapButton: { gap: spacing.xs, minHeight: touch.min, minWidth: touch.min },
  pressed: { opacity: opacity.pressed },
}));
