// Edge-case sender for device testing. Joins a room as a browser participant
// and sends the scenario named on stdin, one per line:
//   draw       a normal red pen ellipse (to have something on screen)
//   proto      a stroke whose tool is "constructor" (must render as a pen)
//   flood      150 tiny strokes in one burst (rate limit must cap them)
//   clear      a Clear frame from this participant (only its ink goes)
//   quit
//
//   PEER_SERVER=https://<host>:8443 PEER_ROOM=scribble-demo node scripts/peer-edge.mjs
import { createInterface } from 'node:readline';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const SERVER = process.env.PEER_SERVER ?? 'https://192.168.8.157:8443';
const ROOM = process.env.PEER_ROOM ?? 'scribble-demo';
const BUNDLE = resolve(here, '../tests/fixtures/test-transport.iife.js');
const log = (event, data = {}) => console.log(JSON.stringify({ event, ...data }));

const browser = await chromium.launch({
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--ignore-certificate-errors'],
});
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
await page.goto(`${SERVER}/${ROOM}#config.prejoinConfig.enabled=false&config.p2p.enabled=false&config.startWithAudioMuted=true&config.startWithVideoMuted=true&userInfo.displayName=%22Edge%22`);
await page.waitForFunction(() => Boolean(window.APP?.store?.getState()?.['features/base/conference']?.conference), undefined, { timeout: 60000 });
await page.addScriptTag({ path: BUNDLE });
await page.evaluate(() => {
  const c = window.APP.store.getState()['features/base/conference'].conference;
  window.__t = window.__jitsiScribbleTestTransport.fromJitsiConference(c, { p2pEnabled: false });
});
log('ready', { id: await page.evaluate(() => window.__t.localId()) });

const q = (x) => Math.round(((Math.min(Math.max(x, -0.5), 1.5) + 0.5) / 2) * 4095);
function ellipse(cx, cy, rx, ry, n = 36) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push([q(cx + rx * Math.cos((i / n) * 2 * Math.PI)), q(cy + ry * Math.sin((i / n) * 2 * Math.PI))]);
  return pts;
}
async function stroke(id, pts, st) {
  await page.evaluate(({ id, pts, st }) => {
    const from = window.__t.localId();
    window.__t.send({ v: 1, t: 's', from, id, p: pts[0], frame: { w: 1080, h: 2400 }, st });
    for (let i = 1; i < pts.length; i += 30) window.__t.send({ v: 1, t: 'm', from, id, pts: pts.slice(i, i + 30) });
    window.__t.send({ v: 1, t: 'e', from, id, kind: 'stroke' });
  }, { id, pts, st });
}

const rl = createInterface({ input: process.stdin });
for await (const line of rl) {
  const cmd = line.trim();
  if (cmd === 'draw') await stroke(`d-${Date.now()}`, ellipse(0.5, 0.3, 0.3, 0.08), { c: '#FF453A', w: 8, k: 'pen' });
  else if (cmd === 'proto') await stroke(`p-${Date.now()}`, ellipse(0.5, 0.55, 0.3, 0.08), { c: '#30D158', w: 8, k: 'constructor' });
  else if (cmd === 'flood') {
    const sent = await page.evaluate(() => {
      const from = window.__t.localId();
      let n = 0;
      for (let i = 0; i < 150; i++) {
        const x = 300 + (i % 15) * 230;
        const y = 2900 + Math.floor(i / 15) * 60;
        window.__t.send({ v: 1, t: 's', from, id: `f-${i}`, p: [x, y], frame: { w: 1080, h: 2400 }, st: { c: '#FFD60A', w: 6, k: 'pen' } });
        window.__t.send({ v: 1, t: 'm', from, id: `f-${i}`, pts: [[x + 120, y + 20]] });
        window.__t.send({ v: 1, t: 'e', from, id: `f-${i}`, kind: 'stroke' });
        n += 3;
      }
      return n;
    });
    log('flood', { frames: sent });
  } else if (cmd === 'clear') await page.evaluate(() => window.__t.send({ v: 1, t: 'c', from: window.__t.localId() }));
  else if (cmd === 'quit') break;
  log('done', { cmd });
}
await browser.close();
