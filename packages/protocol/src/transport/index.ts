// The ScribbleTransport port (ARCHITECTURE.md section 4.1) — "five members,
// no Jitsi vocabulary". Zero dependencies. Deliberately no `to`/`target`/
// `peerId` parameter anywhere on `send` (PROTO-02): per PITFALLS.md Pitfall 3,
// omitting per-peer targeting entirely — not just discouraging it — is what
// makes a Jibri recording never silently ship blank (a targeted message
// never reaches the recorder). Real adapters (Phase 4+) implement this port
// against `lib-jitsi-meet`'s data channel; `MemoryTransport` below is the
// "socket-less demo" reference implementation useful for Phase 3+ tests with
// zero Jitsi dependency.

export type TransportState = 'connecting' | 'ready' | 'degraded' | 'closed';

export interface ScribbleTransport {
  /** Broadcasts a payload to every other participant. No per-peer target —
   * that is precisely the targeting PROTO-02 exists to forbid. */
  send(payload: unknown): void;
  /** Registers a listener invoked on every inbound message. Returns an
   * unsubscribe function. */
  subscribe(fn: (from: string, payload: unknown) => void): () => void;
  /** This transport's own opaque participant ID. */
  localId(): string;
  readonly state: TransportState;
  /** Registers a listener invoked on every transport state transition.
   * Returns an unsubscribe function. */
  onStateChange(fn: (s: TransportState) => void): () => void;
}

/**
 * Reference implementation: an in-memory, socket-less transport. `send()`
 * never throws regardless of `state` — the non-throwing contract every
 * future real adapter must also satisfy (readiness-gating logic is Phase 4's
 * job, not this port's). Not cross-wired to any peer on its own; use
 * `createMemoryTransportPair` to get two instances that deliver to each
 * other.
 */
export class MemoryTransport implements ScribbleTransport {
  private readonly id: string;
  private _state: TransportState = 'connecting';
  private readonly subscribers = new Set<(from: string, payload: unknown) => void>();
  private readonly stateListeners = new Set<(s: TransportState) => void>();
  /** Wired by createMemoryTransportPair to the paired instance's _deliver. */
  private peerDeliver: ((from: string, payload: unknown) => void) | null = null;

  constructor(id: string) {
    this.id = id;
  }

  send(payload: unknown): void {
    this.peerDeliver?.(this.id, payload);
  }

  subscribe(fn: (from: string, payload: unknown) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  localId(): string {
    return this.id;
  }

  get state(): TransportState {
    return this._state;
  }

  onStateChange(fn: (s: TransportState) => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  /** Not part of the ScribbleTransport interface — a reference-implementation
   * testability hook for driving state transitions in tests. Real adapters
   * derive state from the underlying connection, not from an external call. */
  setState(state: TransportState): void {
    this._state = state;
    for (const listener of this.stateListeners) listener(state);
  }

  /** Not part of the ScribbleTransport interface — invoked by the OTHER
   * paired instance's send(), never by this instance's own send(). */
  private _deliver(from: string, payload: unknown): void {
    for (const listener of this.subscribers) listener(from, payload);
  }

  /** Wires this instance's send() to deliver into the other instance. Used
   * only by createMemoryTransportPair. */
  private _wireTo(other: MemoryTransport): void {
    this.peerDeliver = (from, payload) => other._deliver(from, payload);
  }

  static wire(a: MemoryTransport, b: MemoryTransport): void {
    a._wireTo(b);
    b._wireTo(a);
  }
}

/**
 * Cross-wires two MemoryTransport instances so each instance's send() calls
 * the OTHER instance's subscribers with its own localId() as `from` —
 * demonstrating broadcast delivery with no per-peer targeting anywhere in
 * the type.
 */
export function createMemoryTransportPair(idA: string, idB: string): [MemoryTransport, MemoryTransport] {
  const a = new MemoryTransport(idA);
  const b = new MemoryTransport(idB);
  MemoryTransport.wire(a, b);
  return [a, b];
}
