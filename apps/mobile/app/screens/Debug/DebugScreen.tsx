import { useState } from 'react';
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
import { Banner } from '../../components/Banner';
import { Button as SampleButton } from '../../components/Button';
import { GlassSurface } from '../../components/GlassSurface';
import { ListRow } from '../../components/ListRow';
import { Text as SampleText } from '../../components/Text';
import { TextField } from '../../components/TextField';
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
  const [pickup, setPickup] = useState('ផ្សារ');
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
      <View style={typeStyles.components}>
        <SampleText role="title">Ride details · ព័ត៌មានការធ្វើដំណើរ</SampleText>
        <SampleText role="body">
          Pickup at the market · ឡើងជិះនៅផ្សារ
        </SampleText>
        <SampleText role="bodyStrong">
          Fare 12,000 ៛ · តម្លៃ ១២,០០០ ៛
        </SampleText>
        <SampleText role="button">
          Confirm ride · បញ្ជាក់ការធ្វើដំណើរ
        </SampleText>
        <SampleText role="caption" tone="muted">
          Estimated fare · តម្លៃប៉ាន់ស្មាន
        </SampleText>
        <SampleText tone="danger">
          Ride cancelled · ការធ្វើដំណើរត្រូវបានលុបចោល
        </SampleText>
        <SampleButton
          label="Confirm ride · បញ្ជាក់ការធ្វើដំណើរ"
          onPress={() => {}}
        />
        <SampleButton
          label="Edit pickup · កែកន្លែងឡើងជិះ"
          onPress={() => {}}
          variant="secondary"
        />
        <SampleButton
          label="View fare · មើលតម្លៃ"
          onPress={() => {}}
          variant="ghost"
        />
        <SampleButton
          label="Finding a driver · កំពុងស្វែងរកអ្នកបើកបរ"
          onPress={() => {}}
          loading
        />
        <SampleButton
          label="Start ride · ចាប់ផ្តើមការធ្វើដំណើរ"
          onPress={() => {}}
          disabled
        />
        <TextField
          label="Pickup · កន្លែងឡើងជិះ"
          value={pickup}
          onChangeText={setPickup}
        />
        <TextField
          label="Destination · គោលដៅ"
          placeholder="Enter an address · បញ្ចូលអាសយដ្ឋាន"
        />
        <TextField
          label="Phone number · លេខទូរសព្ទ"
          keyboardType="phone-pad"
          error="Enter a valid phone number · បញ្ចូលលេខទូរសព្ទត្រឹមត្រូវ"
        />
        <ListRow
          title="Tuk-tuk · តុកតុក"
          subtitle="Pickup at the market · ឡើងជិះនៅផ្សារ"
          value="12,000 ៛"
          onPress={() => {}}
        />
        <ListRow title="Cash · សាច់ប្រាក់" />
        <Banner message="Driver online · អ្នកបើកបរនៅលើបណ្តាញ" />
        <Banner message="Weak connection · ការតភ្ជាប់ខ្សោយ" tone="warning" />
        <Banner message="Connection lost · ដាច់ការតភ្ជាប់" tone="danger" />
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
  components: {
    backgroundColor: t.colors.background,
    gap: spacing.md,
    marginVertical: spacing.md,
    padding: spacing.md,
  },
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
