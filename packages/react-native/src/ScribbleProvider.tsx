// <ScribbleProvider>: one annotation session for a call, shared by every
// surface under it — <ScribbleOverlay> on the video, <ScribbleToolbar>, and
// the optional out-of-app overlay (@vilancer/scribble-overlay).
//
// The call SDK is plugged in through a *transport provider*: any object
// implementing ScribbleTransport. `jitsi(conference)` (./providers/jitsi) is
// the first one; another video SDK only needs its own adapter, nothing here
// changes.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  SCRIBBLE_COLOURS,
  SCRIBBLE_WIDTHS,
  type ScribbleShape,
  type ScribbleTool,
} from '@vilancer/scribble-protocol/render';
import type { ScribbleTransport } from '@vilancer/scribble-protocol/transport';

import { ScribbleClient, type ScribbleClientOptions } from './client.js';

/** What the user has picked in the toolbar. `shape` set means the next drag
 * draws that shape (with the current tool, colour and width). */
export interface ToolState {
  tool: ScribbleTool;
  color: string;
  width: number;
  shape: ScribbleShape | null;
}

export const DEFAULT_TOOL_STATE: ToolState = {
  tool: 'pen',
  color: SCRIBBLE_COLOURS[5] ?? '#FF453A',
  width: SCRIBBLE_WIDTHS[3],
  shape: null,
};

export interface ScribbleContextValue {
  /** The live session, or null before the transport exists. */
  client: ScribbleClient | null;
  tools: ToolState;
  setTools: (patch: Partial<ToolState>) => void;
  /** Draw mode: when on, touches on <ScribbleOverlay> draw instead of
   * reaching the call UI underneath. */
  drawing: boolean;
  setDrawing: (on: boolean) => void;
  /** Erase this participant's own ink, here and for everyone. */
  clearMine: () => void;
}

const ScribbleContext = createContext<ScribbleContextValue | null>(null);

export interface ScribbleProviderProps extends ScribbleClientOptions {
  /** The call's transport, from a provider adapter such as
   * `jitsi(conference)`. Pass `undefined` until the call is joined; the
   * session starts when it arrives and is rebuilt if it changes. */
  transport: ScribbleTransport | null | undefined;
  /** Starting tool/colour/width. Read once. */
  initialTools?: Partial<ToolState>;
  /** Controlled draw mode (optional). */
  drawing?: boolean;
  onDrawingChange?: (on: boolean) => void;
  children?: ReactNode;
}

export function ScribbleProvider(props: ScribbleProviderProps) {
  const { transport, initialTools, children, holdMs, fadeMs, staleMs } = props;
  const [client, setClient] = useState<ScribbleClient | null>(null);
  const [tools, setToolsState] = useState<ToolState>(() => ({ ...DEFAULT_TOOL_STATE, ...initialTools }));
  const [drawingState, setDrawingState] = useState(false);
  const drawing = props.drawing ?? drawingState;
  const { onDrawingChange } = props;

  useEffect(() => {
    if (!transport) {
      setClient(null);
      return undefined;
    }
    const next = new ScribbleClient(transport, { holdMs, fadeMs, staleMs });
    const stop = next.start();
    setClient(next);
    return () => {
      stop();
      setClient(null);
    };
  }, [transport, holdMs, fadeMs, staleMs]);

  const setTools = useCallback((patch: Partial<ToolState>) => {
    setToolsState((prev) => ({ ...prev, ...patch }));
  }, []);

  const setDrawing = useCallback(
    (on: boolean) => {
      setDrawingState(on);
      onDrawingChange?.(on);
    },
    [onDrawingChange],
  );

  const clearMine = useCallback(() => client?.clearMine(), [client]);

  const value = useMemo<ScribbleContextValue>(
    () => ({ client, tools, setTools, drawing, setDrawing, clearMine }),
    [client, tools, setTools, drawing, setDrawing, clearMine],
  );

  return <ScribbleContext.Provider value={value}>{children}</ScribbleContext.Provider>;
}

/** The surrounding <ScribbleProvider>'s session and tool state. Throws
 * outside a provider. */
export function useScribble(): ScribbleContextValue {
  const ctx = useContext(ScribbleContext);
  if (!ctx) throw new Error('useScribble() must be used inside <ScribbleProvider>');
  return ctx;
}

/** Like useScribble(), but returns null outside a provider instead of
 * throwing. For components that also work standalone. */
export function useOptionalScribble(): ScribbleContextValue | null {
  return useContext(ScribbleContext);
}
