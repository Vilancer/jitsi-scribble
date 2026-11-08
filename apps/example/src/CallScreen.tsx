// A real call over Jitsi: the other side's video (their screen share if
// they have one) with the annotation overlay on top, the drawing toolbar,
// and screen sharing from this phone. Outside the app the other side's ink
// follows the user: the floating pen on Android, a picture-in-picture window,
// a notification and a replay on iOS.
import { useMemo, useRef, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { RTCView } from 'react-native-webrtc';

import { isOutOfAppOverlaySupported, useAwayInk, useOutOfAppOverlay } from '@vilancer/scribble-overlay';
import {
  ScribbleOverlay,
  ScribbleProvider,
  ScribbleToolbar,
  jitsi,
  useScribble,
} from '@vilancer/scribble';

import { IosScreenSharePicker, type IosScreenSharePickerHandle } from './jitsi/IosScreenSharePicker';
import { useJitsiCall, type JitsiCall } from './jitsi/useJitsiCall';
import { CallButton, CallControls, colors, EmptyState, OverlayPermissionCard, StatusPill, styles, type PenSwitch } from './ui';

export function CallScreen(props: { pen: PenSwitch; server: string; room: string; name: string; onLeave: () => void }) {
  const call = useJitsiCall(props.server, props.room, props.name);
  // The transport provider: Jitsi. Rebuilt only when the conference changes.
  const transport = useMemo(() => (call.conference ? jitsi(call.conference) : undefined), [call.conference]);
  return (
    <ScribbleProvider transport={transport}>
      <CallBody call={call} room={props.room} pen={props.pen} onLeave={props.onLeave} />
    </ScribbleProvider>
  );
}

function CallBody({ call, room, pen, onLeave }: { call: JitsiCall; room: string; pen: PenSwitch; onLeave: () => void }) {
  const { drawing, setDrawing } = useScribble();
  const [frameDims, setFrameDims] = useState<{ w: number; h: number } | undefined>(undefined);
  const overlay = useOutOfAppOverlay({
    enabled: pen.penOn,
    showWhen: 'always',
    onDismiss: () => pen.setPenOn(false),
  });
  // iOS: picture-in-picture ink, a notification, and a replay while sharing.
  const away = useAwayInk({ enabled: call.sharing, shareTrackId: call.shareTrackId });
  const picker = useRef<IosScreenSharePickerHandle>(null);

  const video = call.remoteVideo;
  const people = call.participants + 1;
  const status =
    call.status === 'failed'
      ? { tone: 'bad' as const, detail: "Couldn't connect" }
      : call.status !== 'joined'
        ? { tone: 'wait' as const, detail: 'Connecting…' }
        : people < 2
          ? { tone: 'wait' as const, detail: 'Waiting for others' }
          : { tone: 'good' as const, detail: `${people} people` };

  return (
    <View style={styles.root}>
      <StatusPill title={room} detail={status.detail} tone={status.tone} onBack={onLeave} />
      <OverlayPermissionCard overlay={overlay} wanted={pen.penOn} />
      <View style={styles.stage}>
        {away.replaying ? (
          <>
            <Image source={{ uri: away.replaying.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
            <ScribbleOverlay frameDims={{ w: away.replaying.width, h: away.replaying.height }} />
            <View style={replay.banner}>
              <Text style={replay.text}>While you were away</Text>
              <Pressable testID="skip-replay" onPress={away.skipReplay} hitSlop={8} accessibilityRole="button">
                <Text style={replay.skip}>Skip</Text>
              </Pressable>
            </View>
          </>
        ) : video ? (
          <>
            <RTCView
              streamURL={video.streamURL}
              objectFit="contain"
              style={{ flex: 1 }}
              onDimensionsChange={(e: { nativeEvent: { width: number; height: number } }) =>
                setFrameDims({ w: e.nativeEvent.width, h: e.nativeEvent.height })
              }
            />
            <ScribbleOverlay frameDims={frameDims} receiveAnnotations={!overlay.visible} />
          </>
        ) : call.status === 'failed' ? (
          <EmptyState icon="phone" title="Couldn't join the call" body={call.error ?? 'Check the server address and your connection.'} />
        ) : call.sharing ? (
          <EmptyState icon="share" title="You're sharing your screen" body={sharingHelp(pen.penOn, away)} />
        ) : people < 2 ? (
          <EmptyState icon="people" title="Waiting for others to join" body={`Ask them to join the room "${room}".`} />
        ) : (
          <EmptyState icon="share" title="Nothing shared yet" body="When someone shares their screen, it appears here and you can draw on it." />
        )}
        {drawing && video && !away.replaying && (
          <View style={styles.toolbarDock}>
            <ScribbleToolbar />
          </View>
        )}
      </View>
      <IosScreenSharePicker ref={picker} />
      <CallControls>
        <CallButton
          testID="share"
          icon="share"
          label={call.sharing ? 'Stop share' : 'Share'}
          active={call.sharing}
          disabled={call.status !== 'joined'}
          onPress={() => void (call.sharing ? call.stopShare() : call.startShare(() => picker.current?.show() ?? false))}
        />
        <CallButton
          testID="draw"
          icon="pen"
          label="Draw"
          active={drawing}
          disabled={!video}
          onPress={() => setDrawing(!drawing)}
        />
        {isOutOfAppOverlaySupported() && (
          <CallButton
            testID="bubble"
            icon="bubble"
            label="Floating pen"
            active={pen.penOn}
            onPress={() => pen.setPenOn(!pen.penOn)}
          />
        )}
        <CallButton testID="leave" icon="end" label="End" danger onPress={onLeave} />
      </CallControls>
    </View>
  );
}

function sharingHelp(penOn: boolean, away: ReturnType<typeof useAwayInk>): string {
  if (away.supported) {
    if (away.pipError) return `Switch to any app. Drawings made while you're away replay here when you come back. (${away.pipError})`;
    return "Switch to any app. Their drawings show up in a small picture-in-picture window, and replay here when you come back.";
  }
  if (Platform.OS === 'android') {
    return penOn
      ? "Switch to any app. Tap the floating pen there to draw; the other person's drawings show up too."
      : 'Turn on the floating pen to draw over other apps while you share.';
  }
  return "Switch to any app to show it. The other person can point at things on your screen.";
}

const replay = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  text: { color: colors.text, fontSize: 15, fontWeight: '600' },
  skip: { color: colors.blue, fontSize: 15, fontWeight: '600' },
});
