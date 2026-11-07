// Practice mode, no server: this phone plus a simulated "demo partner"
// connected through an in-memory transport pair. The ghost circles and
// points at things every few seconds, so you can see remote ink arrive both
// in the app and, with the floating pen on, over other apps.
import { useEffect, useMemo, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';

import { useOutOfAppOverlay } from '@vilancer/scribble-overlay';
import {
  ScribbleClient,
  ScribbleOverlay,
  ScribbleProvider,
  ScribbleToolbar,
  createMemoryTransportPair,
  useScribble,
} from '@vilancer/scribble';
import { shapePoints } from '@vilancer/scribble-protocol/shapes';

import { CallButton, CallControls, EmptyState, OverlayPermissionCard, StatusPill, styles, type PenSwitch } from './ui';

const GHOST_COLOURS = ['#0A84FF', '#30D158', '#FFD60A', '#BF5AF2'];

/** Every 4 s the ghost draws something somewhere on a full-screen frame. */
function useGhost(client: ScribbleClient, on: boolean, frame: { w: number; h: number }) {
  useEffect(() => {
    if (!on) return undefined;
    let n = 0;
    const draw = (): void => {
      const { store } = client;
      store.tick(Date.now());
      const id = `ghost-${Date.now()}`;
      const kind = (['ellipse', 'arrow', 'rect', 'free'] as const)[n % 4];
      const color = GHOST_COLOURS[n % GHOST_COLOURS.length];
      n++;
      const cx = frame.w * (0.25 + Math.random() * 0.5);
      const cy = frame.h * (0.25 + Math.random() * 0.5);
      const pts =
        kind === 'free'
          ? Array.from({ length: 30 }, (_, i) => ({ x: cx - 120 + i * 8, y: cy + Math.sin(i / 3) * 40 }))
          : shapePoints(kind, { x: cx - 140, y: cy - 90 }, { x: cx + 140, y: cy + 90 });
      store.beginLocal(id, frame, { color, width: 6, tool: n % 3 === 0 ? 'marker' : 'pen' });
      for (const p of pts) store.appendLocal(id, p.x / frame.w, p.y / frame.h);
      store.endLocal(id, 'stroke');
    };
    draw();
    const t = setInterval(draw, 4000);
    return () => clearInterval(t);
  }, [client, on, frame.w, frame.h]);
}

export function SoloScreen({ pen, onLeave }: { pen: PenSwitch; onLeave: () => void }) {
  const [mine, ghostT] = useMemo(() => createMemoryTransportPair('me', 'ghost'), []);
  const ghost = useMemo(() => new ScribbleClient(ghostT), [ghostT]);
  useEffect(() => {
    mine.setState('ready');
    ghostT.setState('ready');
    return ghost.start();
  }, [ghost, mine, ghostT]);
  return (
    <ScribbleProvider transport={mine}>
      <SoloBody ghost={ghost} pen={pen} onLeave={onLeave} />
    </ScribbleProvider>
  );
}

function SoloBody({ ghost, pen, onLeave }: { ghost: ScribbleClient; pen: PenSwitch; onLeave: () => void }) {
  const { drawing, setDrawing } = useScribble();
  const [ghostOn, setGhostOn] = useState(true);
  const [stage, setStage] = useState<{ w: number; h: number } | undefined>(undefined);
  const screen = useWindowDimensions();
  // The partner "shares" a phone-shaped screen, so its ink maps onto this
  // phone's whole display when the floating pen is on.
  useGhost(ghost, ghostOn, { w: screen.width, h: screen.height });
  const overlay = useOutOfAppOverlay({ enabled: pen.penOn, showWhen: 'always', onDismiss: () => pen.setPenOn(false) });

  return (
    <View style={styles.root}>
      <StatusPill title="Practice" detail={ghostOn ? 'Demo partner drawing' : 'Just you'} tone="good" onBack={onLeave} />
      <OverlayPermissionCard overlay={overlay} wanted={pen.penOn} />
      <View
        style={styles.stage}
        onLayout={(e) => setStage({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        {!drawing && (
          <EmptyState
            icon="sparkle"
            title="Try drawing"
            body="Tap Draw to sketch here, or turn on the floating pen and switch to any other app."
          />
        )}
        {/* While the floating layer is up it draws the partner's ink itself. */}
        <ScribbleOverlay frameDims={stage} receiveAnnotations={!overlay.visible} />
        {drawing && (
          <View style={styles.toolbarDock}>
            <ScribbleToolbar />
          </View>
        )}
      </View>
      <CallControls>
        <CallButton testID="draw" icon="pen" label="Draw" active={drawing} onPress={() => setDrawing(!drawing)} />
        <CallButton testID="bubble" icon="bubble" label="Floating pen" active={pen.penOn} onPress={() => pen.setPenOn(!pen.penOn)} />
        <CallButton testID="ghost" icon="people" label="Partner" active={ghostOn} onPress={() => setGhostOn((v) => !v)} />
        <CallButton testID="leave" icon="end" label="End" danger onPress={onLeave} />
      </CallControls>
    </View>
  );
}
