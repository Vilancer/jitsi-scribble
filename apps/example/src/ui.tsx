// The example's call UI kit: round FaceTime-style call buttons with labels,
// the top status pill, a friendly empty state, and the overlay permission card.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Circle, Line, Path, Rect, Svg } from 'react-native-svg';

import type { OutOfAppOverlayState } from '@vilancer/scribble-overlay';

export const colors = {
  bg: '#000000',
  stage: '#0E0E10',
  surface: '#1C1C1E',
  surface2: '#2C2C2E',
  text: '#FFFFFF',
  textDim: '#EBEBF599',
  blue: '#0A84FF',
  green: '#30D158',
  amber: '#FFD60A',
  red: '#FF453A',
};

type IconName = 'share' | 'pen' | 'bubble' | 'end' | 'back' | 'people' | 'sparkle' | 'phone';

export function Icon({ name, color = colors.text, size = 26 }: { name: IconName; color?: string; size?: number }) {
  const p = { stroke: color, strokeWidth: 2, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'share' && (
        <>
          <Rect x={3} y={4} width={18} height={13} rx={2} {...p} />
          <Line x1={9} y1={21} x2={15} y2={21} {...p} />
          <Path d="M12 14 V8 M9 10.5 L12 7.5 L15 10.5" {...p} />
        </>
      )}
      {name === 'pen' && <Path d="M4 20 L5 15 L16 4 L20 8 L9 19 Z M14 6 L18 10" {...p} />}
      {name === 'bubble' && (
        <>
          <Circle cx={12} cy={12} r={9} {...p} />
          <Path d="M8.5 15.5 L9.2 13 L14 8.2 L15.8 10 L11 14.8 Z" {...p} />
        </>
      )}
      {name === 'end' && (
        <Path
          d="M3 14.5 C7.5 10 16.5 10 21 14.5 L19 17 L15.5 15.5 L15.5 13.2 C13.3 12.6 10.7 12.6 8.5 13.2 L8.5 15.5 L5 17 Z"
          fill={color}
          stroke="none"
        />
      )}
      {name === 'back' && <Path d="M15 5 L8 12 L15 19" {...p} />}
      {name === 'people' && (
        <>
          <Circle cx={9} cy={8} r={3.2} {...p} />
          <Path d="M3 19 C3 15.5 5.7 13.5 9 13.5 C12.3 13.5 15 15.5 15 19" {...p} />
          <Path d="M16 5.2 A3 3 0 0 1 16 10.8 M17.5 13.8 C19.6 14.4 21 16.3 21 19" {...p} />
        </>
      )}
      {name === 'sparkle' && <Path d="M12 3 L13.8 10.2 L21 12 L13.8 13.8 L12 21 L10.2 13.8 L3 12 L10.2 10.2 Z" {...p} />}
      {name === 'phone' && (
        <Path d="M5 4 L9 4 L10.5 8.5 L8.5 10 C9.5 12 12 14.5 14 15.5 L15.5 13.5 L20 15 L20 19 C20 20 19 21 18 21 C10 20.5 3.5 14 3 6 C3 5 4 4 5 4 Z" {...p} />
      )}
    </Svg>
  );
}

/** A round call button with a label under it (FaceTime style). */
export function CallButton({
  icon,
  label,
  onPress,
  active,
  danger,
  disabled,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const bg = danger ? colors.red : active ? colors.text : colors.surface2;
  const fg = active && !danger ? colors.bg : colors.text;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      style={({ pressed }) => [styles.callBtnWrap, (pressed || disabled) && { opacity: disabled ? 0.4 : 0.7 }]}
    >
      <View style={[styles.callBtn, { backgroundColor: bg }]}>
        <Icon name={icon} color={fg} size={icon === 'end' ? 34 : 26} />
      </View>
      <Text style={styles.callLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function CallControls({ children }: { children: ReactNode }) {
  return <View style={styles.controls}>{children}</View>;
}

/** Top status pill: room name, people count, and a coloured dot. */
export function StatusPill({
  title,
  detail,
  tone,
  onBack,
}: {
  title: string;
  detail: string;
  tone: 'good' | 'wait' | 'bad';
  onBack?: () => void;
}) {
  const dot = tone === 'good' ? colors.green : tone === 'wait' ? colors.amber : colors.red;
  return (
    <View style={styles.topBar}>
      {onBack ? (
        <Pressable onPress={onBack} accessibilityLabel="Back" style={styles.backBtn} hitSlop={8}>
          <Icon name="back" />
        </Pressable>
      ) : (
        <View style={styles.backBtn} />
      )}
      <View style={styles.pill} accessibilityRole="header" accessibilityLabel={`${title}, ${detail}`}>
        <Text style={styles.pillTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.pillRow}>
          <View style={[styles.dot, { backgroundColor: dot }]} />
          <Text style={styles.pillDetail} numberOfLines={1}>
            {detail}
          </Text>
        </View>
      </View>
      <View style={styles.backBtn} />
    </View>
  );
}

/** Centered icon + headline + one line of help, for empty states. */
export function EmptyState({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={34} color={colors.textDim} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

/** Asks for "Display over other apps" in plain words, only when needed. */
export function OverlayPermissionCard({ overlay, wanted }: { overlay: OutOfAppOverlayState; wanted: boolean }) {
  if (!wanted || !overlay.supported || overlay.permitted) return null;
  return (
    <View style={styles.card} accessibilityRole="alert">
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>Draw over other apps</Text>
        <Text style={styles.cardBody}>Allow it once so the floating pen can appear while you share your screen.</Text>
      </View>
      <Pressable testID="grant-overlay" onPress={overlay.requestPermission} style={styles.cardBtn} accessibilityRole="button">
        <Text style={styles.cardBtnText}>Allow</Text>
      </Pressable>
    </View>
  );
}

export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  stage: { flex: 1, backgroundColor: colors.stage, overflow: 'hidden', borderRadius: 24, marginHorizontal: 8 },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8 },
  backBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  pill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pillTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
  pillDetail: { color: colors.textDim, fontSize: 13 },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'flex-start',
    paddingTop: 16,
    paddingBottom: 12,
    paddingHorizontal: 8,
  },
  callBtnWrap: { alignItems: 'center', width: 84 },
  callBtn: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  callLabel: { color: colors.text, fontSize: 13, marginTop: 6 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: '600', textAlign: 'center' },
  emptyBody: { color: colors.textDim, fontSize: 16, lineHeight: 22, textAlign: 'center', marginTop: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    marginHorizontal: 12,
    marginBottom: 8,
  },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  cardBody: { color: colors.textDim, fontSize: 13, lineHeight: 18, marginTop: 2 },
  cardBtn: { backgroundColor: colors.blue, borderRadius: 18, paddingHorizontal: 18, height: 36, justifyContent: 'center' },
  cardBtnText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  toolbarDock: { position: 'absolute', left: 0, right: 0, bottom: 12 },
});
