import { View } from 'react-native';
import type { Point } from '@lern/contracts';
import { makeStyles, spacing } from '@theme';
import { AppMap } from '../../../components/AppMap';
import { Button } from '../../../components/Button';
import { GlassSurface } from '../../../components/GlassSurface';
import { Text } from '../../../components/Text';

type Action = { label: string; onPress: () => void };

type Props = { title: string } & (
  | {
      pending: {
        pickup: Point;
        mapLabel: string;
        mapUnavailable: string;
        pickupPinLabel: string;
        distance: string;
        fare: string;
        vehicle: string;
        countdown: string;
        accept: Action;
        decline: Action;
        disabled: boolean;
        busy?: 'accept' | 'decline';
        error?: string;
      };
    }
  | { dismiss: Action }
);

export function OfferCard(props: Props) {
  const styles = useStyles();
  return (
    <GlassSurface style={styles.card}>
      <Text role="title">{props.title}</Text>
      {'pending' in props ? (
        <>
          <AppMap
            center={props.pending.pickup}
            pins={[
              {
                id: 'pickup',
                point: props.pending.pickup,
                title: props.pending.pickupPinLabel,
              },
            ]}
            accessibilityLabel={props.pending.mapLabel}
            unavailableLabel={props.pending.mapUnavailable}
          />
          <View style={styles.summary}>
            <Text>{props.pending.distance}</Text>
            <Text role="bodyStrong">{props.pending.fare}</Text>
            <Text>{props.pending.vehicle}</Text>
            <Text role="bodyStrong">{props.pending.countdown}</Text>
          </View>
          <Button
            {...props.pending.accept}
            disabled={props.pending.disabled}
            loading={props.pending.busy === 'accept'}
          />
          <Button
            {...props.pending.decline}
            variant="secondary"
            disabled={props.pending.disabled}
            loading={props.pending.busy === 'decline'}
          />
          {props.pending.error && (
            <Text tone="danger" accessibilityLiveRegion="polite">
              {props.pending.error}
            </Text>
          )}
        </>
      ) : (
        <Button {...props.dismiss} variant="secondary" />
      )}
    </GlassSurface>
  );
}

const useStyles = makeStyles(() => ({
  card: { gap: spacing.sm },
  summary: { gap: spacing.xs },
}));
