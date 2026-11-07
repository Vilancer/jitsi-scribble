// Shared bits of the example's call UI: the control bar and the overlay
// permission banner.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { OutOfAppOverlayState } from '@vilancer/scribble-overlay';

export function ControlButton({
  label,
  onPress,
  active,
  danger,
  testID,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={[styles.button, active && styles.buttonActive, danger && styles.buttonDanger]}
    >
      <Text style={[styles.buttonText, active && styles.buttonTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function ControlBar({ children }: { children: ReactNode }) {
  return <View style={styles.bar}>{children}</View>;
}

export function OverlayPermissionBanner({ overlay }: { overlay: OutOfAppOverlayState }) {
  if (!overlay.supported) {
    return (
      <View style={styles.banner}>
        <Text style={styles.bannerText}>The floating pen works on Android only.</Text>
      </View>
    );
  }
  if (overlay.permitted) return null;
  return (
    <Pressable testID="grant-overlay" style={styles.banner} onPress={overlay.requestPermission}>
      <Text style={styles.bannerText}>
        To draw outside the app, allow "Display over other apps" — tap here, switch it on, then come back.
      </Text>
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  stage: { flex: 1, backgroundColor: '#0B0B0D', overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  hint: { color: '#EBEBF5', opacity: 0.8, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  status: { color: '#EBEBF599', fontSize: 13, paddingHorizontal: 16, paddingVertical: 8 },
  bar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: '#000',
  },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 22,
    backgroundColor: '#2C2C2E',
  },
  buttonActive: { backgroundColor: '#FFFFFF' },
  buttonDanger: { backgroundColor: '#FF453A' },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  buttonTextActive: { color: '#000000' },
  banner: { backgroundColor: '#0A84FF', padding: 12, marginHorizontal: 12, marginTop: 8, borderRadius: 12 },
  bannerText: { color: '#FFFFFF', fontSize: 14, lineHeight: 19 },
  toolbarDock: { position: 'absolute', left: 0, right: 0, bottom: 12 },
});
