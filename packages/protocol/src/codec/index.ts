// The hand-written, zero-dependency, Hermes-safe wire codec — the React
// Native-facing decode path. Zero `effect/*` imports anywhere in this file
// (STACK.md "Prescribed Effect usage rules" item 2): `effect/Schema` throws
// at import time on any engine lacking TextEncoder/TextDecoder (bare RN /
// Hermes without Expo's TextDecoder install), so this file only imports
// `../wire-constants` (a plain relative import) plus, TYPE-ONLY, `WireFrame`
// from `../schema` — erased at compile time, so it never pulls
// `effect/Schema` into the emitted `.js`.
import type { WireFrame } from '../schema/index.js';
import {
  MAX_IDENTIFIER_LENGTH,
  MAX_POINTS_PER_MESSAGE,
  MIN_IDENTIFIER_LENGTH,
  MSG_CLEAR,
  MSG_END,
  MSG_MOVE,
  MSG_PRESENCE,
  MSG_START,
  PROTOCOL_VERSION,
  QUANT_STEPS,
} from '../wire-constants.js';

export type DecodeError =
  | 'invalid-json'
  | 'invalid-type'
  | 'missing-field'
  | 'unknown-message-type'
  | 'version-mismatch'
  | 'coordinate-out-of-range'
  | 'too-many-points'
  | 'empty-points'
  | 'identifier-too-long'
  | 'identifier-empty';

export type DecodeResult = { ok: true; frame: WireFrame } | { ok: false; error: DecodeError };

const KNOWN_TAGS: readonly string[] = [MSG_START, MSG_MOVE, MSG_END, MSG_CLEAR, MSG_PRESENCE];

/** JSON with short single-char tags and already-quantized integers — prioritizes
 * decode-time debuggability over shaving further bytes off an already-compact
 * representation. Phase 3 owns the ~600-byte wire budget's enforcement, not
 * this codec. */
export function encode(frame: WireFrame): string {
  return JSON.stringify(frame);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkIdentifier(value: unknown): DecodeError | null {
  if (typeof value !== 'string') return 'invalid-type';
  if (value.length < MIN_IDENTIFIER_LENGTH) return 'identifier-empty';
  if (value.length > MAX_IDENTIFIER_LENGTH) return 'identifier-too-long';
  return null;
}

function checkCoordinate(value: unknown): DecodeError | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return 'invalid-type';
  if (value < 0 || value > QUANT_STEPS) return 'coordinate-out-of-range';
  return null;
}

function checkPoint(value: unknown): DecodeError | null {
  if (!Array.isArray(value) || value.length !== 2) return 'invalid-type';
  return checkCoordinate(value[0]) ?? checkCoordinate(value[1]);
}

/**
 * Hand-written validator: explicit typeof/Array.isArray/Number.isInteger
 * checks at every field, in a fixed order. Never throws, never returns a
 * partially-built frame — any failure returns the tagged {ok:false, error}
 * immediately.
 */
export function decode(raw: unknown): DecodeResult {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'invalid-json' };
    }
  }

  if (!isPlainObject(obj)) return { ok: false, error: 'invalid-type' };

  if (!('v' in obj)) return { ok: false, error: 'missing-field' };
  if (typeof obj.v !== 'number') return { ok: false, error: 'invalid-type' };
  if (obj.v !== PROTOCOL_VERSION) return { ok: false, error: 'version-mismatch' };

  if (!('t' in obj)) return { ok: false, error: 'missing-field' };
  if (typeof obj.t !== 'string') return { ok: false, error: 'invalid-type' };
  if (!KNOWN_TAGS.includes(obj.t)) return { ok: false, error: 'unknown-message-type' };

  if (!('from' in obj)) return { ok: false, error: 'missing-field' };
  const fromError = checkIdentifier(obj.from);
  if (fromError) return { ok: false, error: fromError };

  switch (obj.t) {
    case MSG_START: {
      if (!('id' in obj)) return { ok: false, error: 'missing-field' };
      const idError = checkIdentifier(obj.id);
      if (idError) return { ok: false, error: idError };

      if (!('p' in obj)) return { ok: false, error: 'missing-field' };
      const pError = checkPoint(obj.p);
      if (pError) return { ok: false, error: pError };

      if (!('frame' in obj)) return { ok: false, error: 'missing-field' };
      const frame = obj.frame;
      if (!isPlainObject(frame)) return { ok: false, error: 'invalid-type' };
      if (typeof frame.w !== 'number' || typeof frame.h !== 'number') return { ok: false, error: 'invalid-type' };
      if (!(frame.w > 0) || !(frame.h > 0) || !Number.isFinite(frame.w) || !Number.isFinite(frame.h)) {
        return { ok: false, error: 'invalid-type' };
      }

      return {
        ok: true,
        frame: {
          v: obj.v as 1,
          t: MSG_START,
          from: obj.from as string,
          id: obj.id as string,
          p: obj.p as [number, number],
          frame: { w: frame.w, h: frame.h },
        },
      };
    }

    case MSG_MOVE: {
      if (!('id' in obj)) return { ok: false, error: 'missing-field' };
      const idError = checkIdentifier(obj.id);
      if (idError) return { ok: false, error: idError };

      if (!('pts' in obj)) return { ok: false, error: 'missing-field' };
      const pts = obj.pts;
      if (!Array.isArray(pts)) return { ok: false, error: 'invalid-type' };
      if (pts.length === 0) return { ok: false, error: 'empty-points' };
      if (pts.length > MAX_POINTS_PER_MESSAGE) return { ok: false, error: 'too-many-points' };
      for (const pt of pts) {
        const ptError = checkPoint(pt);
        if (ptError) return { ok: false, error: ptError };
      }

      return {
        ok: true,
        frame: {
          v: obj.v as 1,
          t: MSG_MOVE,
          from: obj.from as string,
          id: obj.id as string,
          pts: pts as Array<[number, number]>,
        },
      };
    }

    case MSG_END: {
      if (!('id' in obj)) return { ok: false, error: 'missing-field' };
      const idError = checkIdentifier(obj.id);
      if (idError) return { ok: false, error: idError };

      return {
        ok: true,
        frame: { v: obj.v as 1, t: MSG_END, from: obj.from as string, id: obj.id as string },
      };
    }

    case MSG_CLEAR: {
      return { ok: true, frame: { v: obj.v as 1, t: MSG_CLEAR, from: obj.from as string } };
    }

    case MSG_PRESENCE: {
      if (!('vis' in obj)) return { ok: false, error: 'missing-field' };
      if (typeof obj.vis !== 'boolean') return { ok: false, error: 'invalid-type' };

      return {
        ok: true,
        frame: { v: obj.v as 1, t: MSG_PRESENCE, from: obj.from as string, vis: obj.vis },
      };
    }

    default:
      // Unreachable: obj.t was already validated against KNOWN_TAGS above.
      return { ok: false, error: 'unknown-message-type' };
  }
}
