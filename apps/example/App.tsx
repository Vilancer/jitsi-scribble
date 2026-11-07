// jitsi-scribble example: a solo demo (no server) and a real Jitsi call.
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { CallScreen } from './src/CallScreen';
import { SoloScreen } from './src/SoloScreen';

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
  const [name, setName] = useState('Android');
  return (
    <ScrollView contentContainerStyle={home.wrap} keyboardShouldPersistTaps="handled">
      <Text style={home.title}>jitsi-scribble</Text>
      <Text style={home.sub}>Point at things on each other's screens during a call. Ink fades after a few seconds.</Text>

      <Pressable testID="solo" style={home.primary} onPress={onSolo}>
        <Text style={home.primaryText}>Solo demo</Text>
        <Text style={home.primarySub}>No server. A simulated participant draws with you.</Text>
      </Pressable>

      <Text style={home.section}>Join a Jitsi call</Text>
      <Field label="Server" value={server} onChange={setServer} testID="server" />
      <Field label="Room" value={room} onChange={setRoom} testID="room" />
      <Field label="Your name" value={name} onChange={setName} testID="name" />
      <Pressable testID="join" style={home.secondary} onPress={() => onJoin({ server: server.trim(), room: room.trim(), name: name.trim() || 'Android' })}>
        <Text style={home.secondaryText}>Join</Text>
      </Pressable>
    </ScrollView>
  );
}

function Field({ label, value, onChange, testID }: { label: string; value: string; onChange: (v: string) => void; testID: string }) {
  return (
    <View style={home.field}>
      <Text style={home.label}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
        style={home.input}
        placeholderTextColor="#8E8E93"
      />
    </View>
  );
}

const home = StyleSheet.create({
  wrap: { padding: 20, paddingTop: 32, gap: 12, backgroundColor: '#000', flexGrow: 1 },
  title: { color: '#FFF', fontSize: 32, fontWeight: '700' },
  sub: { color: '#EBEBF599', fontSize: 15, lineHeight: 21, marginBottom: 12 },
  primary: { backgroundColor: '#0A84FF', borderRadius: 16, padding: 18 },
  primaryText: { color: '#FFF', fontSize: 18, fontWeight: '700' },
  primarySub: { color: '#FFFFFFCC', fontSize: 14, marginTop: 4 },
  section: { color: '#FFF', fontSize: 17, fontWeight: '600', marginTop: 20 },
  field: { gap: 4 },
  label: { color: '#EBEBF599', fontSize: 13 },
  input: { backgroundColor: '#1C1C1E', color: '#FFF', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  secondary: { backgroundColor: '#2C2C2E', borderRadius: 14, padding: 15, alignItems: 'center', marginTop: 6 },
  secondaryText: { color: '#FFF', fontSize: 17, fontWeight: '600' },
});
