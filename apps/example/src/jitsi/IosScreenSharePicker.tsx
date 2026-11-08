// iOS screen sharing goes through a ReplayKit broadcast extension
// (plugins/withIosScreenShare.js). react-native-webrtc's getDisplayMedia does
// NOT open the system broadcast sheet: it resolves at once with a track that
// stays black until the user starts the broadcast. The sheet only opens from
// rn-webrtc's ScreenCapturePickerView, so render this once (hidden) and call
// show() right after the desktop track is added. Renders nothing on Android.
import { forwardRef, useImperativeHandle, useRef, type ComponentType, type Ref } from 'react';
import { findNodeHandle, NativeModules, Platform } from 'react-native';
import { ScreenCapturePickerView } from 'react-native-webrtc';

const PickerView = ScreenCapturePickerView as unknown as ComponentType<{ ref?: Ref<unknown>; style?: object }>;

export interface IosScreenSharePickerHandle {
  /** Opens the system broadcast sheet. False when it can't (Android, or a
   * build without the extension): no frames will ever arrive then. */
  show: () => boolean;
}

export const IosScreenSharePicker = forwardRef<IosScreenSharePickerHandle>(function IosScreenSharePicker(_props, ref) {
  const viewRef = useRef(null);
  useImperativeHandle(ref, () => ({
    show() {
      if (Platform.OS !== 'ios') return false;
      const tag = findNodeHandle(viewRef.current);
      const manager = NativeModules.ScreenCapturePickerViewManager;
      if (tag == null || typeof manager?.show !== 'function') return false;
      manager.show(tag);
      return true;
    },
  }));
  if (Platform.OS !== 'ios') return null;
  return <PickerView ref={viewRef} style={{ position: 'absolute', width: 0, height: 0, opacity: 0 }} />;
});
