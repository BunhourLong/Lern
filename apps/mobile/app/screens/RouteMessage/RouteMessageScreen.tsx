import { ActivityIndicator, View } from 'react-native';
import { makeStyles, spacing, useTheme } from '@theme';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';

type Action = { label: string; onPress: () => void };

type Props =
  | { loadingLabel: string }
  | {
      title: string;
      body?: string;
      updateAction?: Action & { loading: boolean; error?: string };
      debugAction?: Action;
    };

export default function RouteMessageScreen(props: Props) {
  const { colors } = useTheme();
  const styles = useStyles();

  if ('loadingLabel' in props) {
    return (
      <Screen>
        <View style={styles.loading}>
          <ActivityIndicator
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={props.loadingLabel}
            accessibilityState={{ busy: true }}
            color={colors.primary}
          />
        </View>
      </Screen>
    );
  }

  const { title, body, updateAction, debugAction } = props;
  return (
    <Screen scroll>
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
        {debugAction && (
          <Button
            label={debugAction.label}
            onPress={debugAction.onPress}
            variant="secondary"
          />
        )}
      </View>
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  loading: { flex: 1, justifyContent: 'center' },
  message: { gap: spacing.md },
}));
