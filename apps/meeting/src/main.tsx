import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { captureAdapter } from 'fork-perception';
import { createHttpClient } from './integration/client';
import { createFixtureClient, getFixturePreviewConfig } from './integration/fixture';
import { emptyState, reduceEvent, type WorkspaceState } from './integration/state';
import { decodePreview, previewUrl } from './integration/bridge';
import './style.css';

// No dashboard, no manual start/pause/stop, no consent checkbox: Fork listens as
// soon as it has a session and shows only the live prototype. This page is what
// gets captured as Fork's video feed (see apps/meet-bot). The operator's kill
// switch is stopping the process (Ctrl+C on `npm run dev`), not a page control.
const fixture = import.meta.env.FORK_MODE === 'fixture';
const fixtureClient = fixture ? createFixtureClient() : null;
const client = fixtureClient || createHttpClient('/api', import.meta.env.FORK_PROJECT_CONFIG_ID, import.meta.env.FORK_PROJECT_MODE);
const allowedPreviewOrigin = import.meta.env.FORK_PREVIEW_ORIGIN;
if (fixtureClient) (window as unknown as { forkFixture: typeof fixtureClient }).forkFixture = fixtureClient; // console-only dev hook: forkFixture.advanceScenario()

function Presenter() {
  const [state, setState] = useState<WorkspaceState>(emptyState);
  const frame = useRef<HTMLIFrameElement>(null);
  const captureStarted = useRef(false);
  const captureGeneration = useRef(0);
  const mounted = useRef(true);
  const snapshot = state.snapshot;
  const safeUrl = previewUrl(snapshot?.previewUrl || null, allowedPreviewOrigin);

  function sendFixtureConfig() {
    if (fixture && snapshot && frame.current?.contentWindow) {
      frame.current.contentWindow.postMessage(getFixturePreviewConfig(snapshot), allowedPreviewOrigin);
    }
  }
  useEffect(() => { sendFixtureConfig(); }, [snapshot?.revision.source, snapshot?.revision.config, safeUrl]);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false, unsubscribe: (() => void) | undefined;
    const id = new URLSearchParams(location.search).get('session');
    void (id && !fixture ? client.snapshot(id) : client.create()).then(async value => {
      if (cancelled) return;
      setState({ ...emptyState, snapshot: value });
      const url = new URL(location.href);
      url.searchParams.set('session', value.id);
      history.replaceState(null, '', url);
      unsubscribe = client.subscribe(value.id, value.lastEventSequence,
        event => { if (!cancelled) setState(previous => reduceEvent(previous, event)); }, () => {});
      if (fixture) return;
      try {
        await client.capture(value.id, 'start');
        if (!captureAdapter.available) { console.warn('[fork] No capture adapter connected (A is not wired up). Not listening.'); return; }
        const generation = ++captureGeneration.current;
        await captureAdapter.start({ sessionId: value.id, captureEpoch: value.captureEpoch, sink: async observations => {
          if (!mounted.current || captureGeneration.current !== generation) return;
          await client.observe(value.id, observations);
        } });
        if (!mounted.current || captureGeneration.current !== generation) { await captureAdapter.stop(); return; }
        captureStarted.current = true;
        console.log('[fork] Listening.');
      } catch (error) { console.error('[fork] Could not start capture:', error); }
    }).catch(error => console.error('[fork] Could not start session:', error));
    return () => {
      cancelled = true; mounted.current = false; captureGeneration.current++; unsubscribe?.();
      if (captureStarted.current) { captureStarted.current = false; void captureAdapter.stop().catch(() => {}); }
    };
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    const listener = (event: MessageEvent) => {
      const data = decodePreview(event, frame.current?.contentWindow || null, allowedPreviewOrigin, snapshot.workspaceId, snapshot.revision);
      if (!data) return;
      if (data.type === 'fork.preview.error') console.error('[fork] Preview error:', data.message);
      if (data.type === 'fork.preview.context' && snapshot.capture === 'listening' && !fixture) {
        const { type: _, ...context } = data;
        void client.observe(snapshot.id, [{ ...context, kind: 'preview_context', id: crypto.randomUUID(), sessionId: snapshot.id, captureEpoch: snapshot.captureEpoch, capturedAt: new Date().toISOString(), version: 1 }])
          .catch(error => console.error('[fork] Could not send preview context:', error));
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [snapshot]);

  return <div className="presenter-view">
    {safeUrl
      ? <iframe ref={frame} title="Fork prototype presenter" src={safeUrl} sandbox="allow-scripts allow-same-origin" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'" referrerPolicy="no-referrer" onLoad={sendFixtureConfig} />
      : <div className="presenter-empty"><span className="fork-spark">⑂</span><p>Waiting for a preview…</p></div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<Presenter />);
