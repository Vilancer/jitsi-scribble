// Ambient module declarations for the native Jitsi stack (Phase A0+).
// lib-jitsi-meet ships no types for its ESM subpath entry, and `base-64` has none.

declare module 'lib-jitsi-meet/dist/esm/JitsiMeetJS' {
  const JitsiMeetJS: any;
  export default JitsiMeetJS;
}

declare module 'base-64' {
  export function encode(input: string): string;
  export function decode(input: string): string;
}
