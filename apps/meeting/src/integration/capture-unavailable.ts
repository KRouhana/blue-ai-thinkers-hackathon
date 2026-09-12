import type { CaptureAdapter } from './types';
const unavailable = async () => { throw new Error('A’s capture adapter is not connected. No microphone or meeting audio is being captured.'); };
export const captureAdapter: CaptureAdapter = {
  source: 'Capture adapter not connected', available: false,
  start: unavailable, pause: unavailable, resume: unavailable, stop: async () => {},
};
