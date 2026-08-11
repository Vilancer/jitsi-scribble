import { useRef, useState } from 'react';
import {
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';

import { ScribbleOverlay } from '@vilancer/react-native';
import { MemoryTransport } from '@vilancer/protocol/transport';

// UAT harness only (see README.md) — a single unwired MemoryTransport.
// send() is a documented no-op when unwired (ScribbleTransport's contract:
// "send() never throws regardless of state"), so this never reaches a real
// peer. Every stroke you see is your own touch rendered locally by
// ScribbleOverlay/useScribbleSession — exactly the real gesture worklet,
// real fade timing, and real SVG rendering Phase 5 shipped. There is no
// second participant in this build; cross-device delivery is not what this
// app tests.
const transport = new MemoryTransport('uat-local-device');

const { width, height } = Dimensions.get('window');
// Stand-in "video" content rect — a fixed 16:9 box, matching what a real
// Jitsi remote video tile would report via VideoView's own measured layout.
const FRAME_DIMS = { w: width, h: Math.round((width * 9) / 16) };

export default function App() {
  const [drawMode, setDrawMode] = useState(false);
  const [muted, setMuted] = useState(false);
  const [hungUp, setHungUp] = useState(false);
  const tapCountRef = useRef(0);
  const [tapCount, setTapCount] = useState(0);

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="light" />

      {/* Fake call screen — stands in for the real video tile so item 5
          (mute/hang-up-through-the-overlay) can be checked: does draw mode
          swallow taps meant for these buttons, and does turning draw mode
          off let them through cleanly. This is a PROXY only — it never joins
          a real Jitsi call. Full item-5 coverage still needs Phase 6's
          Genius_Native integration. */}
      <View style={[styles.callScreen, hungUp && styles.callScreenEnded]}>
        <Text style={styles.callLabel}>
          {hungUp ? 'Call ended' : muted ? 'Muted' : 'In call (fake)'}
        </Text>
        {!hungUp && (
          <View style={styles.callControls}>
            <Pressable
              style={[styles.callButton, muted && styles.callButtonActive]}
              onPress={() => {
                setMuted((v) => !v);
                tapCountRef.current += 1;
                setTapCount(tapCountRef.current);
              }}
            >
              <Text style={styles.callButtonText}>{muted ? 'Unmute' : 'Mute'}</Text>
            </Pressable>
            <Pressable
              style={[styles.callButton, styles.hangupButton]}
              onPress={() => {
                setHungUp(true);
                tapCountRef.current += 1;
                setTapCount(tapCountRef.current);
              }}
            >
              <Text style={styles.callButtonText}>Hang up</Text>
            </Pressable>
          </View>
        )}
      </View>

      <ScribbleOverlay
        drawModeEnabled={drawMode}
        receiveAnnotations
        transport={transport}
        frameDims={FRAME_DIMS}
      />

      <View style={styles.hud} pointerEvents="none">
        <Text style={styles.hudText}>
          draw mode: {drawMode ? 'ON' : 'off'} · call taps: {tapCount}
        </Text>
      </View>

      <Pressable
        style={[styles.fab, drawMode && styles.fabActive]}
        onPress={() => setDrawMode((v) => !v)}
      >
        <Text style={styles.fabText}>{drawMode ? '✕' : '✏️'}</Text>
      </Pressable>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111' },
  callScreen: {
    flex: 1,
    backgroundColor: '#1c3d5a',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  callScreenEnded: { backgroundColor: '#222' },
  callLabel: { color: 'white', fontSize: 20, fontWeight: '600' },
  callControls: { flexDirection: 'row', gap: 16 },
  callButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  callButtonActive: { backgroundColor: 'rgba(255,196,0,0.35)' },
  hangupButton: { backgroundColor: 'rgba(255,59,48,0.45)' },
  callButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  hud: {
    position: 'absolute',
    top: 48,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hudText: {
    color: 'white',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    fontSize: 12,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 60,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabActive: { backgroundColor: 'rgba(255,59,48,0.85)' },
  fabText: { fontSize: 22 },
});
