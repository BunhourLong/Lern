import type { Point } from '@lern/contracts';
import { Platform, Pressable, View } from 'react-native';
import {
  makeStyles,
  opacity,
  outlineWidth,
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
import type { DriverCancelReason } from '../driver-ride';

type Action = { label: string; onPress: () => void };

type CancelPicker = {
  open: boolean;
  openLabel: string;
  prompt: string;
  reasons: readonly { value: DriverCancelReason; label: string }[];
  selected?: DriverCancelReason;
  confirmLabel: string;
  keepLabel: string;
  disabled: boolean;
  loading: boolean;
  error?: string;
  onOpen: () => void;
  onSelect: (value: DriverCancelReason) => void;
  onConfirm: () => void;
  onKeep: () => void;
};

type Props = { title: string; fare: string; vehicle: string } & (
  | {
      variant: 'active';
      map: {
        center: Point;
        delta: number;
        pins: readonly MapPin[];
        label: string;
        unavailableLabel: string;
      };
      step: Action & { disabled: boolean; loading: boolean };
      queuedNotice?: string;
      stepError?: string;
      cancel?: CancelPicker;
    }
  | { variant: 'ended'; dismiss: Action }
);

export function DriverRideCard(props: Props) {
  const styles = useStyles();
  const summary = (
    <View style={styles.summary}>
      <Text role="bodyStrong">{props.fare}</Text>
      <Text>{props.vehicle}</Text>
    </View>
  );

  return (
    <GlassSurface style={styles.card}>
      <Text role="title">{props.title}</Text>
      {props.variant === 'active' ? (
        <>
          <AppMap
            center={props.map.center}
            delta={props.map.delta}
            pins={props.map.pins}
            size="active"
            accessibilityLabel={props.map.label}
            unavailableLabel={props.map.unavailableLabel}
          />
          {summary}
          <Button {...props.step} />
          {props.queuedNotice && (
            <Banner tone="warning" message={props.queuedNotice} />
          )}
          {props.stepError && (
            <Text tone="danger" accessibilityLiveRegion="polite">
              {props.stepError}
            </Text>
          )}
          {props.cancel && <CancelRidePicker {...props.cancel} />}
        </>
      ) : (
        <>
          {summary}
          <Button variant="secondary" {...props.dismiss} />
        </>
      )}
    </GlassSurface>
  );
}

function CancelRidePicker(cancel: CancelPicker) {
  const styles = useStyles();
  const interact = useInteraction();

  if (!cancel.open) {
    return (
      <Button
        variant="secondary"
        label={cancel.openLabel}
        onPress={cancel.onOpen}
        disabled={cancel.disabled}
      />
    );
  }

  return (
    <>
      <View
        accessible={Platform.OS === 'android'}
        accessibilityRole="radiogroup"
        accessibilityLabel={cancel.prompt}
        style={styles.reasons}
      >
        <Text
          role="bodyStrong"
          accessibilityRole="header"
          importantForAccessibility="no"
        >
          {cancel.prompt}
        </Text>
        {cancel.reasons.map(({ value, label }) => {
          const checked = cancel.selected === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ checked, disabled: cancel.loading }}
              disabled={cancel.loading}
              onPress={() => {
                if (interact()) cancel.onSelect(value);
              }}
              style={({ pressed }) => [
                styles.reason,
                checked && styles.checked,
                pressed && styles.pressed,
              ]}
            >
              <Text role="bodyStrong" tone={checked ? 'primary' : 'default'}>
                {label}
              </Text>
            </Pressable>
          );
        })}
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
  reasons: { gap: spacing.sm },
  reason: {
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
  checked: { borderColor: t.colors.primary },
  pressed: { opacity: opacity.pressed },
}));
