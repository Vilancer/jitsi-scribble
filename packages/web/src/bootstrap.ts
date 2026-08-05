// The side-effecting entry point (WEB-05/WEB-08) — the code that would be
// pasted directly into docker-jitsi-meet's `custom-config.js` (Phase 6 owns
// the real mount; this file is what runs once that mount happens). Runs
// inside another application's page, so a thrown error here is a
// shared-fate failure for every other participant — everything is wrapped
// in a top-level try/catch, and the inner mountScribbleOverlay call gets its
// own try/catch too.
import { whenConference } from './jitsiMeetWeb.js';
import { mountScribbleOverlay } from './mount.js';

interface WindowWithMountGuard {
  __jitsiScribbleMounted?: boolean;
}

/**
 * WEB-02's concurrency edge: a script injected twice into the same page (a
 * double `custom-config.js` include, a re-run of this same bundle) must not
 * attach a second endpoint-message subscription or double-render every
 * stroke. The guard check runs FIRST, before any logging — a second
 * invocation logs one warning and returns, never reaching the WEB-08
 * "bootstrap loaded" line.
 *
 * WEB-08: every invocation that passes the guard logs exactly one
 * `[jitsi-scribble] bootstrap loaded` line (with a `(recorder)` suffix when
 * `location.hash` contains `iAmRecorder=true`) unconditionally, before
 * calling `whenConference` — regardless of what happens afterward.
 *
 * WEB-05: the whole body is wrapped in a top-level try/catch, and the
 * `mountScribbleOverlay` call inside `whenConference`'s callback gets its
 * own inner try/catch — a failure at either level degrades silently
 * (`console.warn`) instead of propagating into jitsi-meet's own page code.
 */
export function bootstrap(): void {
  try {
    const w = window as unknown as WindowWithMountGuard;
    if (w.__jitsiScribbleMounted) {
      console.warn('[jitsi-scribble] bootstrap already mounted in this page — skipping duplicate invocation');
      return;
    }
    w.__jitsiScribbleMounted = true;

    const isRecorder = location.hash.includes('iAmRecorder=true');
    console.log(`[jitsi-scribble] bootstrap loaded${isRecorder ? ' (recorder)' : ''}`);

    whenConference((conf, store) => {
      try {
        mountScribbleOverlay(conf, store);
      } catch (e) {
        console.warn('[jitsi-scribble] mount failed, annotation disabled for this session', e);
      }
    });
  } catch (e) {
    console.warn('[jitsi-scribble] bootstrap failed to install', e);
  }
}

// Module-evaluation-time side effect — this is what fires when the IIFE
// build's own entry (Plan 04-03) is evaluated on jitsi-meet's page. A bare
// `import { mountScribbleOverlay } from '@vilancer/web'` never reaches this
// file (index.ts deliberately does not re-export it), so this side effect
// never fires on a plain package import.
bootstrap();
