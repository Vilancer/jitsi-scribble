// A headless browser participant for device testing. Joins a Jitsi room in
// the real jitsi-meet web app (fake camera), builds the shipped transport
// from the page's conference, logs every annotation frame it receives, and
// draws a test shape on a timer. Screenshots go to PEER_SHOTS.
//
//   PEER_SERVER=https://192.168.8.157:8443 PEER_ROOM=scribble-demo node scripts/peer.mjs
//
// Env: PEER_DRAW_EVERY_MS (0 = never draw), PEER_DURATION_MS, PEER_SHOTS,
// PEER_VIDEO=desktop to pretend the fake camera is a screen share.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const SERVER = process.env.PEER_SERVER ?? 'https://192.168.8.157:8443';
const ROOM = process.env.PEER_ROOM ?? 'scribble-demo';
const DRAW_EVERY = Number(process.env.PEER_DRAW_EVERY_MS ?? 6000);
const DURATION = Number(process.env.PEER_DURATION_MS ?? 600000);
const SHOTS = process.env.PEER_SHOTS ?? resolve(here, '../test-results/peer');
const BUNDLE = resolve(here, '../tests/fixtures/test-transport.iife.js');
mkdirSync(SHOTS, { recursive: true });

const log = (event, data = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), event, ...data }));

const browser = await chromium.launch({
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--ignore-certificate-errors'],
});
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
page.on('pageerror', (e) => log('pageerror', { message: String(e) }));

const hash = [
  'config.prejoinConfig.enabled=false',
  'config.p2p.enabled=false',
  'config.startWithAudioMuted=true',
  'config.startWithVideoMuted=false',
  'userInfo.displayName=%22Browser%22',
].join('&');
await page.goto(`${SERVER}/${ROOM}#${hash}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.APP?.store?.getState()?.['features/base/conference']?.conference), undefined, {
  timeout: 60000,
});
log('joined', { room: ROOM });
// Make sure the fake camera is actually sending, so a phone viewer has a
// video to annotate.
await page.evaluate(() => window.APP?.conference?.muteVideo?.(false)).catch(() => {});
await page.addScriptTag({ path: BUNDLE });
const localId = await page.evaluate(() => {
  const conference = window.APP.store.getState()['features/base/conference'].conference;
  const t = window.__jitsiScribbleTestTransport.fromJitsiConference(conference, { p2pEnabled: false });
  window.__t = t;
  window.__rx = [];
  t.subscribe((from, payload) => window.__rx.push({ from, payload }));
  // The shipped web renderer, so screenshots show the ink on #largeVideo.
  window.__jitsiScribbleTestTransport.mountScribbleOverlay(conference, window.APP.store);
  return t.localId();
});
log('transport', { localId });

let n = 0;
const q = (x) => Math.round(((Math.min(Math.max(x, -0.5), 1.5) + 0.5) / 2) * 4095);
async function drawTestShape() {
  const id = `peer-${Date.now()}`;
  const cx = 0.3 + Math.random() * 0.4;
  const cy = 0.3 + Math.random() * 0.4;
  const pts = [];
  for (let i = 0; i <= 36; i++) pts.push([q(cx + 0.18 * Math.cos((i / 36) * 2 * Math.PI)), q(cy + 0.08 * Math.sin((i / 36) * 2 * Math.PI))]);
  const colors = ['#0A84FF', '#30D158', '#FFD60A', '#FF453A'];
  const st = { c: colors[n++ % 4], w: 6, k: n % 2 ? 'pen' : 'marker' };
  await page.evaluate(
    ({ id, pts, st }) => {
      const from = window.__t.localId();
      window.__t.send({ v: 1, t: 's', from, id, p: pts[0], frame: { w: 1080, h: 2400 }, st });
      window.__t.send({ v: 1, t: 'm', from, id, pts: pts.slice(1, 32) });
      window.__t.send({ v: 1, t: 'm', from, id, pts: pts.slice(32) });
      window.__t.send({ v: 1, t: 'e', from, id, kind: 'stroke' });
    },
    { id, pts, st },
  );
  log('sent', { id, color: st.c, tool: st.k });
}

const started = Date.now();
let lastDraw = 0;
let shot = 0;
while (Date.now() - started < DURATION) {
  const rx = await page.evaluate(() => window.__rx.splice(0));
  for (const r of rx) {
    const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
    log('rx', { from: r.from, type: p?.t, id: p?.id, st: p?.st, n: p?.pts?.length, kind: p?.kind, vis: p?.vis });
    if (p?.t === 'e') {
      await page.screenshot({ path: resolve(SHOTS, `rx-${String(++shot).padStart(3, '0')}.png`) });
    }
  }
  if (DRAW_EVERY > 0 && Date.now() - lastDraw > DRAW_EVERY) {
    log('state', await page.evaluate(() => {
      const c = window.APP.store.getState()['features/base/conference'].conference;
      return { transport: window.__t.state, channelOpen: Boolean(c?.rtc?._channel?.isOpen?.()), participants: c.getParticipants().map((p) => p.getId()) };
    }));
    lastDraw = Date.now();
    await drawTestShape();
  }
  await page.waitForTimeout(250);
}
await browser.close();
