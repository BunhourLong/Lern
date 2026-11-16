import {
  Button,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RawEvent } from '../../stores/raw-events.store';

export type DebugScreenProps = {
  state: unknown;
  events: RawEvent[];
  phone: string;
  code: string;
  onPhone(v: string): void;
  onCode(v: string): void;
  onSendCode(): void;
  onVerify(): void;
  onSignOut(): void;
  onOnline(): void;
  onOffline(): void;
};

export default function DebugScreen(p: DebugScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      contentContainerStyle={{ paddingTop: insets.top + 8, padding: 8 }}
    >
      <TextInput
        accessibilityLabel="Phone"
        style={styles.input}
        value={p.phone}
        onChangeText={p.onPhone}
      />
      <TextInput
        accessibilityLabel="Code"
        style={styles.input}
        value={p.code}
        onChangeText={p.onCode}
      />
      <View>
        <Button title="Send code" onPress={p.onSendCode} />
        <Button title="Verify" onPress={p.onVerify} />
        <Button title="Sign out" onPress={p.onSignOut} />
        <Button title="Go online" onPress={p.onOnline} />
        <Button title="Go offline" onPress={p.onOffline} />
      </View>
      <Text style={styles.mono}>{JSON.stringify(p.state, null, 2)}</Text>
      {p.events.map((e, i) => (
        <Text key={i} style={styles.mono}>
          {e.at} {e.event} {JSON.stringify(e.payload)}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: 'Courier', fontSize: 11 },
  input: { fontFamily: 'Courier', borderWidth: 1, padding: 4, margin: 2 },
});
