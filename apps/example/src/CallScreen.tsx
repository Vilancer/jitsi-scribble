// A real call over Jitsi: the other side's video (their screen share if
// they have one) with the annotation overlay on top, the drawing toolbar,
// and screen sharing from this phone with the floating pen outside the app.
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { RTCView } from 'react-native-webrtc';

import { useOutOfAppOverlay } from '@vilancer/scribble-overlay';
import {
  ScribbleOverlay,
  ScribbleProvider,
  ScribbleToolbar,
  jitsi,
  useScribble,
} from '@vilancer/scribble';

import { useJitsiCall, type JitsiCall } from './jitsi/useJitsiCall';
import { ControlBar, ControlButton, OverlayPermissionBanner, styles } from './ui';

export function CallScreen(props: { server: string; room: string; name: string; onLeave: () => void }) {
  const call = useJitsiCall(props.server, props.room, props.name);
  // The transport provider: Jitsi. Rebuilt only when the conference changes.
  const transport = useMemo(() => (call.conference ? jitsi(call.conference) : undefined), [call.conference]);
  return (
    <ScribbleProvider transport={transport}>
      <CallBody call={call} room={props.room} onLeave={props.onLeave} />
    </ScribbleProvider>
  );
}

function CallBody({ call, room, onLeave }: { call: JitsiCall; room: string; onLeave: () => void }) {
  const { drawing, setDrawing, client } = useScribble();
  const [bubbleAlways, setBubbleAlways] = useState(false);
  const [frameDims, setFrameDims] = useState<{ w: number; h: number } | undefined>(undefined);
  const overlay = useOutOfAppOverlay({
    enabled: call.sharing || bubbleAlways,
    showWhen: bubbleAlways ? 'always' : 'background',
  });

  const video = call.remoteVideo;
  // Frames received from the other side, shown in the status line.
  const [rx, setRx] = useState(0);
  useEffect(() => {
    if (!client) return undefined;
    const off = client.onInbound(() => setRx((n) => n + 1));
    return () => {
      off();
    };
  }, [client]);

  return (
    <View style={styles.root}>
      <Text style={styles.status} testID="call-status">
        {room} · {call.status}
        {call.error ? ` · ${call.error}` : ''} · {call.participants + 1} in call
        {client ? ` · ${client.transport.state} · ${rx} frames in` : ''}
      </Text>
      <OverlayPermissionBanner overlay={overlay} />
      <View style={styles.stage}>
        {video ? (
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
        ) : (
          <View style={styles.center}>
            <Text style={styles.hint}>
              {call.sharing
                ? 'You are sharing your screen.\n\nGo to any app: a floating pen appears. Tap it to draw on your screen; whatever the other side draws shows up there too.'
                : 'Waiting for the other side to share their screen.\n\nOr share yours with the button below.'}
            </Text>
          </View>
        )}
        {drawing && video && (
          <View style={styles.toolbarDock}>
            <ScribbleToolbar />
          </View>
        )}
      </View>
      <ControlBar>
        {video && (
          <ControlButton testID="draw" label={drawing ? 'Drawing' : 'Draw'} active={drawing} onPress={() => setDrawing(!drawing)} />
        )}
        <ControlButton
          testID="share"
          label={call.sharing ? 'Stop sharing' : 'Share screen'}
          active={call.sharing}
          onPress={() => void (call.sharing ? call.stopShare() : call.startShare())}
        />
        <ControlButton
          testID="bubble"
          label={bubbleAlways ? 'Hide pen' : 'Floating pen'}
          active={bubbleAlways}
          onPress={() => setBubbleAlways((v) => !v)}
        />
        <ControlButton testID="leave" label="Leave" danger onPress={onLeave} />
      </ControlBar>
    </View>
  );
}
