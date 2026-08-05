// DRAW-09: the sibling-view root element. `ScribbleOverlay` is placed by the
// host app (Phase 6's `VideoTile`) as an absolutely-positioned sibling of its
// own video view — never a wrapper, never re-parenting the host's content.
// This is a minimal, real placeholder: Plan 05-04 extends this exact file
// in place with real props/children (gesture capture, stroke rendering) —
// it is not replaced wholesale.
import { StyleSheet, View } from 'react-native';

export function ScribbleOverlay() {
  return <View style={StyleSheet.absoluteFillObject} pointerEvents="none" />;
}
