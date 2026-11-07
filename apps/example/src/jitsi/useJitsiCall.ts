// A deliberately small lib-jitsi-meet client for the example app: join a
// room without auth, show the other side's video (preferring a screen
// share), and share this phone's screen. Genius_Native's
// useJitsiConference is the production-grade version of the same flow.
//
// The polyfills MUST load before lib-jitsi-meet's module body runs, so this
// file imports them first.
import './jitsiPolyfills';
import JitsiMeetJS from 'lib-jitsi-meet/dist/esm/JitsiMeetJS';
import { useCallback, useEffect, useRef, useState } from 'react';

export type CallStatus = 'connecting' | 'joined' | 'failed' | 'left';

export interface RemoteVideo {
  participantId: string;
  streamURL: string;
  isScreen: boolean;
}

export interface JitsiCall {
  status: CallStatus;
  error: string | null;
  /** The lib-jitsi-meet JitsiConference, once created. Feed it to jitsi(). */
  conference: unknown | null;
  participants: number;
  remoteVideo: RemoteVideo | null;
  sharing: boolean;
  startShare: () => Promise<void>;
  stopShare: () => Promise<void>;
  leave: () => void;
}

let initialized = false;
function initOnce(): void {
  if (initialized) return;
  JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels.ERROR);
  JitsiMeetJS.init({ disableAudioLevels: true });
  initialized = true;
}

/** `server` like "http://192.168.1.10:8000" or "https://meet.example.com"
 * (an open docker-jitsi-meet with ENABLE_AUTH=0). */
export function useJitsiCall(server: string, room: string, displayName: string): JitsiCall {
  const [status, setStatus] = useState<CallStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [conference, setConference] = useState<any>(null);
  const [participants, setParticipants] = useState(0);
  const [videos, setVideos] = useState<Record<string, RemoteVideo>>({});
  const [sharing, setSharing] = useState(false);
  const connectionRef = useRef<any>(null);
  const conferenceRef = useRef<any>(null);
  const desktopRef = useRef<any>(null);

  useEffect(() => {
    initOnce();
    let cancelled = false;
    const url = new URL(server);
    const ws = `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}/xmpp-websocket?room=${encodeURIComponent(room)}`;
    const connection = new JitsiMeetJS.JitsiConnection(null, null, {
      serviceUrl: ws,
      hosts: { domain: 'meet.jitsi', muc: 'muc.meet.jitsi' },
      clientNode: 'https://github.com/Vilancer/jitsi-scribble',
    });
    connectionRef.current = connection;
    const CE = JitsiMeetJS.events.conference;
    const XE = JitsiMeetJS.events.connection;

    const applyTrack = (track: any): void => {
      if (track.isLocal?.() || track.getType?.() !== 'video') return;
      const pid = track.getParticipantId?.();
      const streamURL = track.getOriginalStream?.()?.toURL?.();
      if (!pid || !streamURL) return;
      setVideos((prev) => ({
        ...prev,
        [pid]: { participantId: pid, streamURL, isScreen: track.getVideoType?.() === 'desktop' },
      }));
    };

    const onEstablished = (): void => {
      if (cancelled) return;
      const conf = connection.initJitsiConference(room, {
        p2p: { enabled: false },
        disableSimulcast: true,
        videoQuality: { codecPreferenceOrder: ['VP8', 'H264'], mobileCodecPreferenceOrder: ['VP8', 'H264'] },
      });
      conferenceRef.current = conf;
      conf.setDisplayName(displayName);
      const count = (): void => setParticipants(conf.getParticipants().length);
      conf.on(CE.CONFERENCE_JOINED, () => {
        if (cancelled) return;
        setStatus('joined');
        setConference(conf);
        // Ask the bridge for the other side's video at full screen-share
        // resolution (multi-stream bridges forward nothing until asked).
        try {
          conf.setReceiverVideoConstraint?.(1080);
        } catch {
          // older/newer lib-jitsi-meet: forwarding defaults apply
        }
        count();
      });
      conf.on(CE.USER_JOINED, count);
      conf.on(CE.USER_LEFT, (id: string) => {
        count();
        setVideos((prev) => {
          const { [id]: _gone, ...rest } = prev;
          return rest;
        });
      });
      conf.on(CE.TRACK_ADDED, (track: any) => {
        applyTrack(track);
        track.on?.(JitsiMeetJS.events.track.TRACK_VIDEOTYPE_CHANGED, () => applyTrack(track));
      });
      conf.on(CE.TRACK_REMOVED, (track: any) => {
        if (track.isLocal?.() || track.getType?.() !== 'video') return;
        const pid = track.getParticipantId?.();
        setVideos((prev) => {
          const { [pid]: _gone, ...rest } = prev;
          return rest;
        });
      });
      conf.on(CE.CONFERENCE_FAILED, (e: unknown) => {
        setError(String(e));
        setStatus('failed');
      });
      conf.join();
    };

    connection.addEventListener(XE.CONNECTION_ESTABLISHED, onEstablished);
    connection.addEventListener(XE.CONNECTION_FAILED, (e: unknown) => {
      if (cancelled) return;
      setError(`connection failed: ${String(e)}`);
      setStatus('failed');
    });
    connection.connect();

    return () => {
      cancelled = true;
      try {
        desktopRef.current?.dispose?.();
        conferenceRef.current?.leave?.();
        connection.disconnect();
      } catch {
        // tearing down anyway
      }
      conferenceRef.current = null;
      setConference(null);
    };
  }, [server, room, displayName]);

  const startShare = useCallback(async () => {
    const conf = conferenceRef.current;
    if (!conf || desktopRef.current) return;
    try {
      const [desktop] = await JitsiMeetJS.createLocalTracks({ devices: ['desktop'] });
      desktopRef.current = desktop;
      desktop.on?.(JitsiMeetJS.events.track.LOCAL_TRACK_STOPPED, () => {
        desktopRef.current = null;
        setSharing(false);
      });
      await conf.addTrack(desktop);
      setSharing(true);
    } catch (e) {
      setError(`screen share: ${String((e as Error)?.message ?? e)}`);
    }
  }, []);

  const stopShare = useCallback(async () => {
    const conf = conferenceRef.current;
    const desktop = desktopRef.current;
    desktopRef.current = null;
    setSharing(false);
    if (!desktop) return;
    try {
      await conf?.removeTrack(desktop);
    } finally {
      desktop.dispose?.();
    }
  }, []);

  const leave = useCallback(() => {
    setStatus('left');
  }, []);

  const list = Object.values(videos);
  const remoteVideo = list.find((v) => v.isScreen) ?? list[0] ?? null;

  return { status, error, conference, participants, remoteVideo, sharing, startShare, stopShare, leave };
}
