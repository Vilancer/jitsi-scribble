// jitsi-scribble example: a solo demo (no server) and a real Jitsi call.
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { CallScreen } from './src/CallScreen';
import { SoloScreen } from './src/SoloScreen';
import { colors, Icon } from './src/ui';

// Default server: a local docker-jitsi-meet (see apps/example/README.md).
const DEFAULT_SERVER = process.env.EXPO_PUBLIC_JITSI_SERVER ?? 'http://192.168.8.157:8000';

type Screen = { kind: 'home' } | { kind: 'solo' } | { kind: 'call'; server: string; room: string; name: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }} edges={['top', 'bottom']}>
          <StatusBar style="light" />
          {screen.kind === 'home' && <Home onSolo={() => setScreen({ kind: 'solo' })} onJoin={(s) => setScreen({ kind: 'call', ...s })} />}
          {screen.kind === 'solo' && <SoloScreen onLeave={() => setScreen({ kind: 'home' })} />}
          {screen.kind === 'call' && (
            <CallScreen server={screen.server} room={screen.room} name={screen.name} onLeave={() => setScreen({ kind: 'home' })} />
          )}
        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Home({ onSolo, onJoin }: { onSolo: () => void; onJoin: (s: { server: string; room: string; name: string }) => void }) {
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [room, setRoom] = useState('scribble-demo');
  const [name, setName] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const canJoin = room.trim().length > 0 && server.trim().length > 0;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={home.wrap} keyboardShouldPersistTaps="handled">
        <View style={home.hero}>
          <View style={home.logo}>
            <Icon name="pen" size={30} />
          </View>
          <Text style={home.title}>Scribble</Text>
          <Text style={home.sub}>Point at things on each other's screens during a call. Drawings fade after a few seconds.</Text>
        </View>

        <Pressable testID="solo" style={({ pressed }) => [home.card, pressed && home.pressed]} onPress={onSolo} accessibilityRole="button">
          <View style={[home.cardIcon, { backgroundColor: colors.blue }]}>
            <Icon name="sparkle" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={home.cardTitle}>Practice on your own</Text>
            <Text style={home.cardBody}>No call needed. A demo partner draws with you.</Text>
          </View>
        </Pressable>

        <View style={home.card}>
          <View style={{ flex: 1, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <View style={[home.cardIcon, { backgroundColor: colors.green }]}>
                <Icon name="phone" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={home.cardTitle}>Join a call</Text>
                <Text style={home.cardBody}>Use the same room name as the other person.</Text>
              </View>
            </View>
            <Field label="Room" value={room} onChange={setRoom} testID="room" placeholder="e.g. team-standup" />
            <Field label="Your name (optional)" value={name} onChange={setName} testID="name" placeholder="Shown to others" />
            {advanced && <Field label="Server" value={server} onChange={setServer} testID="server" placeholder="https://meet.example.com" />}
            <Pressable onPress={() => setAdvanced((v) => !v)} hitSlop={8} accessibilityRole="button">
              <Text style={home.link}>{advanced ? 'Hide server' : 'Change server'}</Text>
            </Pressable>
            <Pressable
              testID="join"
              disabled={!canJoin}
              style={({ pressed }) => [home.join, !canJoin && { opacity: 0.4 }, pressed && home.pressed]}
              onPress={() => onJoin({ server: server.trim(), room: room.trim(), name: name.trim() || 'Android' })}
              accessibilityRole="button"
            >
              <Text style={home.joinText}>Join</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  value,
  onChange,
  testID,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testID: string;
  placeholder?: string;
}) {
  return (
    <View style={home.field}>
      <Text style={home.label}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={placeholder}
        placeholderTextColor="#8E8E93"
        style={home.input}
        accessibilityLabel={label}
      />
    </View>
  );
}

const home = StyleSheet.create({
  wrap: { padding: 20, paddingTop: 16, gap: 14, backgroundColor: colors.bg, flexGrow: 1 },
  hero: { alignItems: 'center', marginBottom: 4 },
  logo: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  title: { color: colors.text, fontSize: 30, fontWeight: '700' },
  sub: { color: colors.textDim, fontSize: 16, lineHeight: 22, textAlign: 'center', marginTop: 8, paddingHorizontal: 12 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: 20, padding: 16 },
  pressed: { opacity: 0.75 },
  cardIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: '600' },
  cardBody: { color: colors.textDim, fontSize: 14, lineHeight: 19, marginTop: 2 },
  field: { gap: 6 },
  label: { color: colors.textDim, fontSize: 13 },
  input: { backgroundColor: colors.surface2, color: colors.text, borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 16 },
  link: { color: colors.blue, fontSize: 15 },
  join: { backgroundColor: colors.green, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  joinText: { color: colors.text, fontSize: 17, fontWeight: '600' },
});
