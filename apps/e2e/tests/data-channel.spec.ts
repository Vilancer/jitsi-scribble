// Plan 06-02 Task 1 — INTEG-01/INTEG-02 against REAL staging infrastructure.
//
// Two independent Chromium contexts join the same dedicated ephemeral room on
// the staging deployment, each constructs its own TEST-OWNED transport from
// the page's real lib-jitsi-meet conference object (via 06-01's
// test-transport.iife.js — the exact shipped fromJitsiConference, never a
// reimplementation), and a MSG_START wire frame sent by A must arrive at B
// over the actual Jitsi bridge data channel. No MemoryTransport, no mocks.
//
// The room name carries a timestamp + random suffix so test traffic can
// never collide with a real teacher/student session on the shared staging
// deployment (this plan's own prohibition; T-06-02-01).
import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';

const STAGING_ORIGIN = 'https://poseidonx.duckdns.org';
const BUNDLE_PATH = resolve(__dirname, 'fixtures/test-transport.iife.js');

/** Stable wire constants (packages/protocol/src/wire-constants.ts) — inlined
 * per the plan's own allowance, since they are frozen wire-format literals. */
const PROTOCOL_VERSION = 1;
const MSG_START = 's';

/**
 * The staging deployment runs docker-jitsi-meet with AUTH_TYPE=jwt
 * (iss=genius_tod, aud=genius_jitsi) and ENABLE_GUESTS=1: an anonymous
 * guest cannot START a room ("Waiting for a moderator…"), but can join one
 * a moderator already started. So participant A carries a short-lived
 * HS256 moderator token minted here from E2E_JITSI_JWT_SECRET (gitignored
 * .env.e2e, loaded by playwright.config.ts), with
 * context.user.affiliation='teacher' — the exact claim
 * mod_genius_role_enforcer.lua promotes to owner/moderator. Participant B
 * joins as a plain guest, exercising the same mixed moderator+guest shape a
 * real teacher/student call has.
 *
 * Known, accepted staging side effect: mod_genius_auto_record starts a
 * Jibri recording when any moderator-claim participant joins, so each
 * ephemeral e2e room produces a short throwaway recording + webhook noise.
 */
function mintModeratorJwt(): string {
  const secret = process.env.E2E_JITSI_JWT_SECRET;
  if (!secret) {
    throw new Error(
      'E2E_JITSI_JWT_SECRET is not set — create apps/e2e/.env.e2e (see this spec\'s header comment)',
    );
  }
  const b64 = (value: object | Buffer): string =>
    (Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)))
      .toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({
    iss: 'genius_tod',
    aud: 'genius_jitsi',
    sub: '*',
    room: '*',
    nbf: now - 10,
    exp: now + 2 * 60 * 60,
    context: {
      user: { id: 'e2e-moderator', name: 'E2E Moderator', affiliation: 'teacher' },
    },
  });
  const signature = b64(
    createHmac('sha256', secret).update(`${header}.${payload}`).digest(),
  );
  return `${header}.${payload}.${signature}`;
}

function ephemeralRoom(): string {
  return `jitsi-scribble-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function roomUrl(room: string, opts?: { moderator?: boolean }): string {
  // URL-hash config overrides: skip the prejoin screen (the automated
  // contexts can't click "Join"), join muted (fake media is enough), and
  // pin p2p off so a 1:1 test call cannot silently switch off the bridge
  // channel mid-test (the exact failure mode PROTO-08 warns hosts about).
  // (The deployment also sets ENABLE_P2P=0 server-side — belt and braces.)
  const hash = [
    'config.prejoinConfig.enabled=false',
    'config.p2p.enabled=false',
    'config.startWithAudioMuted=true',
    'config.startWithVideoMuted=true',
  ].join('&');
  const jwt = opts?.moderator ? `?jwt=${mintModeratorJwt()}` : '';
  return `${STAGING_ORIGIN}/${room}${jwt}#${hash}`;
}

interface JitsiWindow {
  APP?: {
    store?: {
      getState: () => Record<string, { conference?: unknown } | undefined>;
    };
  };
  __jitsiScribbleTestTransport?: {
    fromJitsiConference: (conference: unknown, opts?: unknown) => unknown;
  };
  __transportOk?: { ok: boolean; localId?: string; error?: string };
  __received?: Array<{ from: string; payload: unknown }>;
}

async function joinConference(browser: Browser, url: string): Promise<Page> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // The redux conference object appearing IS "joined" — jitsi-meet sets
  // features/base/conference.conference only once the CONFERENCE_JOINED
  // action fires. Real signaling, so a generous bound.
  await page.waitForFunction(
    () => {
      const w = window as unknown as JitsiWindow;
      const state = w.APP?.store?.getState();
      return Boolean(state?.['features/base/conference']?.conference);
    },
    undefined,
    { timeout: 45_000 },
  );
  await page.addScriptTag({ path: BUNDLE_PATH });
  return page;
}

/** Constructs a test-owned transport from the page's REAL conference object.
 * Returns a structured result rather than throwing, so a construction
 * failure is reported as "construction threw: <named methods>" distinctly
 * from a delivery timeout (RESEARCH.md's separated-assertions guidance). */
async function constructTransport(page: Page): Promise<{ ok: boolean; localId?: string; error?: string }> {
  return page.evaluate(() => {
    const w = window as unknown as JitsiWindow;
    try {
      const conference = w.APP!.store!.getState()['features/base/conference']!.conference;
      const transport = w.__jitsiScribbleTestTransport!.fromJitsiConference(conference, {
        p2pEnabled: false,
      }) as {
        localId(): string;
        send(payload: unknown): void;
        subscribe(fn: (from: string, payload: unknown) => void): () => void;
      };
      (w as unknown as { __transport: typeof transport }).__transport = transport;
      return { ok: true, localId: transport.localId() };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });
}

test.describe('data channel on real staging (INTEG-01 / INTEG-02)', () => {
  test('INTEG-02: constructing the adapter against the real conference does not throw (a lib-jitsi-meet upgrade removing the send method turns THIS red, naming all three probed methods)', async ({
    browser,
  }) => {
    const page = await joinConference(browser, roomUrl(ephemeralRoom(), { moderator: true }));
    const result = await constructTransport(page);

    // resolveSend()'s own throw names sendMessage/broadcastEndpointMessage/
    // sendEndpointMessage — surfaced here verbatim if construction failed.
    expect(result.error ?? '').toBe('');
    expect(result.ok).toBe(true);
    expect(result.localId).toBeTruthy();

    await page.context().close();
  });

  test('INTEG-01: a MSG_START frame sent by participant A arrives at participant B over the bridge data channel', async ({
    browser,
  }) => {
    const room = ephemeralRoom();
    // A (moderator, JWT) must join FIRST — an anonymous guest cannot start
    // a room on this deployment. B then joins as a plain guest.
    const pageA = await joinConference(browser, roomUrl(room, { moderator: true }));
    const pageB = await joinConference(browser, roomUrl(room));

    const constructedA = await constructTransport(pageA);
    const constructedB = await constructTransport(pageB);
    expect(constructedA.ok, constructedA.error).toBe(true);
    expect(constructedB.ok, constructedB.error).toBe(true);

    // B subscribes BEFORE A sends (never a race).
    await pageB.evaluate(() => {
      const w = window as unknown as JitsiWindow & {
        __transport: { subscribe(fn: (from: string, payload: unknown) => void): () => void };
      };
      w.__received = [];
      w.__transport.subscribe((from, payload) => {
        w.__received!.push({ from, payload });
      });
    });

    // A valid MSG_START wire frame: p is a quantized 12-bit int tuple
    // (packages/protocol schema: Point = Tuple(int 0..4095)), frame carries
    // the sender's source dimensions (PROTO-04's standalone-decodable rule).
    const frame = {
      v: PROTOCOL_VERSION,
      t: MSG_START,
      from: constructedA.localId!,
      id: 'e2e-test-stroke',
      p: [2048, 2048],
      frame: { w: 1280, h: 720 },
    };

    // Send-with-retry: the bridge channel's SCTP setup completes a few
    // seconds AFTER conference join, and a send into a not-yet-open channel
    // is deliberately dropped by the adapter (PROTO-06/07's never-throw,
    // never-queue contract — the exact behavior 04's specs pin). INTEG-01
    // proves delivery over the real channel, not first-shot delivery, so
    // A re-sends the identical frame once per second until B observes it,
    // bounded at 30s.
    let delivered = false;
    for (let attempt = 0; attempt < 30 && !delivered; attempt++) {
      await pageA.evaluate((wireFrame) => {
        const w = window as unknown as { __transport: { send(payload: unknown): void } };
        w.__transport.send(wireFrame);
      }, frame);
      try {
        await pageB.waitForFunction(
          () => {
            const w = window as unknown as JitsiWindow;
            return (w.__received?.length ?? 0) > 0;
          },
          undefined,
          { timeout: 1_000 },
        );
        delivered = true;
      } catch {
        // not yet — channel likely still opening; retry
      }
    }
    expect(delivered).toBe(true);

    const received = await pageB.evaluate(() => {
      const w = window as unknown as JitsiWindow;
      return w.__received!;
    });

    // Retries can land more than one copy of the identical frame — every
    // copy must be the frame A sent, attributed to A's real participant id
    // (the adapter's `from` comes from participant.getId() at
    // ENDPOINT_MESSAGE_RECEIVED).
    expect(received.length).toBeGreaterThanOrEqual(1);
    for (const entry of received) {
      expect(entry.payload).toEqual(frame);
      expect(entry.from).toBe(constructedA.localId);
    }

    await pageA.context().close();
    await pageB.context().close();
  });
});
