import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Edge } from 'react-native-safe-area-context';
import { makeStyles, spacing } from '@theme';

export function Screen({
  children,
  scroll,
  edges,
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
}) {
  const styles = useStyles();

  return (
    <SafeAreaView edges={edges} style={styles.screen}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.content}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, styles.content]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const useStyles = makeStyles(t => ({
  screen: { flex: 1, backgroundColor: t.colors.background },
  fill: { flex: 1 },
  content: { padding: spacing.md },
}));
