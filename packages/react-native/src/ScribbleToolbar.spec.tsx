// The toolbar edits the provider's tool state, and a stroke drawn with that
// state carries it on the wire to the other participant.
import { act, fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { createMemoryTransportPair } from '@vilancer/scribble-protocol/transport';

import { ScribbleClient } from './client.js';
import { ScribbleProvider, useScribble } from './ScribbleProvider.js';
import { ScribbleToolbar } from './ScribbleToolbar.js';

function Probe({ onClient }: { onClient: (c: ScribbleClient | null) => void }) {
  const { tools, drawing, client } = useScribble();
  onClient(client);
  return <Text testID="probe">{JSON.stringify({ ...tools, drawing })}</Text>;
}

function state(getByTestId: (id: string) => { props: { children: string } }) {
  return JSON.parse(getByTestId('probe').props.children);
}

describe('ScribbleToolbar', () => {
  it('picks tool, shape, colour and size into the provider state; done ends draw mode', async () => {
    const [a] = createMemoryTransportPair('a', 'b');
    let client: ScribbleClient | null = null;
    const ui = await render(
      <ScribbleProvider transport={a} drawing={true}>
        <ScribbleToolbar />
        <Probe onClient={(c) => (client = c)} />
      </ScribbleProvider>,
    );
    expect(client).not.toBeNull();

    await fireEvent.press(ui.getByTestId('scribble-tool-marker'));
    expect(state(ui.getByTestId as never)).toMatchObject({ tool: 'marker', shape: null });

    await fireEvent.press(ui.getByTestId('scribble-shape-arrow'));
    expect(state(ui.getByTestId as never)).toMatchObject({ tool: 'marker', shape: 'arrow' });

    await fireEvent.press(ui.getByTestId('scribble-colour-#0A84FF'));
    expect(state(ui.getByTestId as never).color).toBe('#0A84FF');

    await fireEvent.press(ui.getByTestId('scribble-size'));
    await fireEvent.press(ui.getByTestId('scribble-size-12'));
    expect(state(ui.getByTestId as never).width).toBe(12);

    await fireEvent.press(ui.getByTestId('scribble-more-colours'));
    expect(ui.getByTestId('scribble-toolbar-grid')).toBeTruthy();

    await ui.unmount();
  });

  it('clear removes this participant’s ink on the other side', async () => {
    const [a, b] = createMemoryTransportPair('a', 'b');
    const viewer = new ScribbleClient(b);
    const stopViewer = viewer.start();
    const ui = await render(
      <ScribbleProvider transport={a}>
        <ScribbleToolbar />
        <Probe onClient={() => undefined} />
      </ScribbleProvider>,
    );
    // Draw something as "a" through the provider's client.
    const holder: { c: ScribbleClient | null } = { c: null };
    await ui.rerender(
      <ScribbleProvider transport={a}>
        <ScribbleToolbar />
        <Probe onClient={(c) => (holder.c = c)} />
      </ScribbleProvider>,
    );
    await act(async () => {
      holder.c!.store.beginLocal('s1', { w: 10, h: 10 }, { color: '#FFFFFF', width: 4, tool: 'pen' });
      holder.c!.store.appendLocal('s1', 0.5, 0.5);
    });
    expect(viewer.store.snapshot()).toHaveLength(1);

    await fireEvent.press(ui.getByTestId('scribble-clear'));
    expect(viewer.store.snapshot()).toHaveLength(0);

    await ui.unmount();
    stopViewer();
  });
});
