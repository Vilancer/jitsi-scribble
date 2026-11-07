// The overlay must follow the provider's session when it is rebuilt with
// the same participant id (e.g. new timing options).
import { act, fireEvent, render } from '@testing-library/react-native';
import type { LayoutChangeEvent } from 'react-native';

import { createMemoryTransportPair } from '@vilancer/scribble-protocol/transport';

import { ScribbleClient } from './client.js';
import { ScribbleOverlay } from './ScribbleOverlay.js';
import { ScribbleProvider } from './ScribbleProvider.js';

const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 100, height: 100 } } } as unknown as LayoutChangeEvent;

it('renders remote ink after the provider rebuilds its session', async () => {
  const [mine, theirs] = createMemoryTransportPair('me', 'them');
  const remote = new ScribbleClient(theirs);
  const stopRemote = remote.start();
  const tree = (holdMs: number) => (
    <ScribbleProvider transport={mine} holdMs={holdMs}>
      <ScribbleOverlay frameDims={{ w: 100, h: 100 }} />
    </ScribbleProvider>
  );
  const ui = await render(tree(2000));
  await act(async () => {
    fireEvent(ui.getByTestId('scribble-overlay-root'), 'layout', layout);
  });
  await ui.rerender(tree(3000)); // new session, same participant id
  await act(async () => {
    fireEvent(ui.getByTestId('scribble-overlay-root'), 'layout', layout);
  });
  await act(async () => {
    remote.store.beginLocal('s1', { w: 100, h: 100 });
    remote.store.appendLocal('s1', 0.2, 0.2);
    remote.store.appendLocal('s1', 0.6, 0.6);
    remote.store.endLocal('s1', 'stroke');
  });
  expect(ui.getByTestId('scribble-stroke-them-s1-core')).toBeTruthy();
  await ui.unmount();
  stopRemote();
});
