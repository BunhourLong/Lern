import {
  Button,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles, spacing, type } from '@theme';
import { GlassSurface } from '../../components/GlassSurface';
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
  const typeStyles = useTypeStyles();
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
      <View style={typeStyles.sample}>
        <Text style={typeStyles.title}>Book a tuk-tuk · កក់តុកតុក</Text>
        <Text style={typeStyles.body}>
          Pickup at the market · ឡើងជិះនៅផ្សារ
        </Text>
        <Text style={typeStyles.bodyStrong}>
          Fare 12,000 ៛ · តម្លៃ ១២,០០០ ៛
        </Text>
        <Text style={typeStyles.button}>
          Confirm ride · បញ្ជាក់ការធ្វើដំណើរ
        </Text>
        <Text style={typeStyles.caption}>Estimated fare · តម្លៃប៉ាន់ស្មាន</Text>
      </View>
      <View style={typeStyles.glassBackdrop}>
        <GlassSurface>
          <Text style={typeStyles.bodyStrong}>Glass surface · ផ្ទៃកញ្ចក់</Text>
          <Text style={typeStyles.body}>
            Pickup at the market · ឡើងជិះនៅផ្សារ
          </Text>
        </GlassSurface>
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

const useTypeStyles = makeStyles(t => ({
  sample: {
    backgroundColor: t.colors.surface,
    gap: spacing.xs,
    marginVertical: spacing.md,
    padding: spacing.sm,
  },
  glassBackdrop: { backgroundColor: t.colors.primary, padding: spacing.md },
  title: { ...type.title, color: t.colors.text },
  body: { ...type.body, color: t.colors.text },
  bodyStrong: { ...type.bodyStrong, color: t.colors.text },
  button: { ...type.button, color: t.colors.text },
  caption: { ...type.caption, color: t.colors.text },
}));

const debugFontFamily = 'Courier';
const styles = StyleSheet.create({
  mono: { fontFamily: debugFontFamily, fontSize: 11 },
  input: { fontFamily: debugFontFamily, borderWidth: 1, padding: 4, margin: 2 },
});
