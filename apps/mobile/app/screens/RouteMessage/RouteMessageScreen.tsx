import { ActivityIndicator, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import { makeStyles, spacing, useTheme } from '@theme';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';

type Action = { label: string; onPress: () => void };

type Props = { edges?: Edge[]; secondaryAction?: Action } & (
  | { loadingLabel: string }
  | {
      title: string;
      body?: string;
      updateAction?: Action & { loading: boolean; error?: string };
      primaryAction?: Action;
    }
);

export default function RouteMessageScreen(props: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { secondaryAction } = props;
  const secondaryButton = secondaryAction && (
    <Button
      label={secondaryAction.label}
      onPress={secondaryAction.onPress}
      variant="secondary"
    />
  );

  if ('loadingLabel' in props) {
    return (
      <Screen edges={props.edges}>
        <View style={styles.loading}>
          <ActivityIndicator
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={props.loadingLabel}
            accessibilityState={{ busy: true }}
            color={colors.primary}
          />
          {secondaryButton}
        </View>
      </Screen>
    );
  }

  const { title, body, updateAction, primaryAction } = props;
  return (
    <Screen scroll edges={props.edges}>
      <View style={styles.message}>
        <Text role="title">{title}</Text>
        {body && <Text>{body}</Text>}
        {updateAction && (
          <>
            <Button
              label={updateAction.label}
              onPress={updateAction.onPress}
              loading={updateAction.loading}
            />
            {updateAction.error && (
              <Text tone="danger" accessibilityLiveRegion="polite">
                {updateAction.error}
              </Text>
            )}
          </>
        )}
        {primaryAction && (
          <Button label={primaryAction.label} onPress={primaryAction.onPress} />
        )}
        {secondaryButton}
      </View>
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  loading: { flex: 1, justifyContent: 'center', gap: spacing.md },
  message: { gap: spacing.md },
}));
